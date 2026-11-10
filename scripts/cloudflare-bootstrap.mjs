import { randomBytes } from 'node:crypto';

export const WORKER_NAME = 'time-saver-quotes';
export const DATABASE_NAME = 'time-saver-security';
export const FRONTEND_ORIGIN = 'https://timesaverautomate.com';
export const WRANGLER_VERSION = '4.160.0';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ACCOUNT_ID = /^[a-f0-9]{32}$/i;
const repositoryId = '1452563434';

class SetupError extends Error {
  constructor(code, httpStatus, operation) { super(code); this.code = code; this.httpStatus=httpStatus; this.operation=operation; }
}
function requireSetup(condition, code) {
  if (!condition) throw new SetupError(code);
}

// Esta instalação serve apenas a API desativada. Não tem uma opção para ativar email.
// As dependências são injetáveis para testar os limites sem credenciais ou recursos reais.
export async function bootstrapCloudflare({ env, fetcher = fetch, command, saveConfig,
  mask = () => {}, generateKey = () => randomBytes(32).toString('hex') }) {
  let backendOrigin = null;
  try {
    requireSetup(env.GITHUB_REPOSITORY_ID === repositoryId
      && env.GITHUB_REPOSITORY === 'timesaverautomate/time-saver'
      && env.GITHUB_REF === 'refs/heads/main', 'unauthorised_repository');
    const apiToken = env.CLOUDFLARE_API_TOKEN;
    requireSetup(typeof apiToken === 'string' && apiToken.length >= 20
      && apiToken.length <= 512 && !/[\s\x00-\x1f\x7f]/.test(apiToken), 'missing_cloudflare_token');
    requireSetup(typeof env.RESEND_API_KEY === 'string'
      && /^re_[A-Za-z0-9_-]{8,256}$/.test(env.RESEND_API_KEY), 'missing_resend_key');
    requireSetup(typeof command === 'function' && typeof saveConfig === 'function', 'missing_installer');

    async function cloudflare(endpoint, { method = 'GET', body, allowNotFound = false } = {}) {
      const operation=endpoint.startsWith('/zones?') ? 'zone_account_discovery'
        : endpoint.startsWith('/accounts?') ? 'account_discovery'
        : endpoint.endsWith('/workers/subdomain') ? 'workers_subdomain'
        : endpoint.endsWith('/settings') ? 'worker_settings'
        : endpoint.endsWith('/secrets') ? 'worker_secret_metadata'
        : endpoint.includes('/d1/database') ? 'd1_database' : 'cloudflare_request';
      let response;
      try {
        response = await fetcher('https://api.cloudflare.com/client/v4' + endpoint, {
          method, redirect:'error', signal:AbortSignal.timeout(20_000),
          headers:{ Authorization:'Bearer ' + apiToken, 'Content-Type':'application/json' },
          ...(body === undefined ? {} : { body:JSON.stringify(body) })
        });
      } catch { throw new SetupError('cloudflare_unreachable'); }
      if (allowNotFound && response.status === 404) return null;
      if (!response.ok) throw new SetupError('cloudflare_access_or_request_failed',response.status,operation);
      let data;
      try { data = await response.json(); } catch { throw new SetupError('cloudflare_invalid_response'); }
      requireSetup(data.success === true && data.result !== undefined, 'cloudflare_invalid_response');
      return data.result;
    }

    let accountId = env.CLOUDFLARE_ACCOUNT_ID || '';
    if (!accountId) {
      // Se o token permitir ler a zona conhecida, identificar a conta sem exigir seleção manual.
      const zones=await cloudflare('/zones?name=timesaverautomate.com&per_page=50').catch(()=>null);
      const matches=Array.isArray(zones) ? zones.filter(zone=>zone.name==='timesaverautomate.com') : [];
      if (matches.length===1 && ACCOUNT_ID.test(matches[0].account?.id || '')) accountId=matches[0].account.id;
      else {
        const accounts = await cloudflare('/accounts?per_page=50');
        requireSetup(Array.isArray(accounts) && accounts.length === 1, 'account_selection_required');
        accountId = accounts[0].id;
      }
    }
    requireSetup(ACCOUNT_ID.test(accountId), 'invalid_account_id');
    const base = '/accounts/' + accountId;
    const subdomain = await cloudflare(base + '/workers/subdomain');
    requireSetup(typeof subdomain?.subdomain === 'string'
      && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain.subdomain), 'workers_onboarding_required');
    backendOrigin = 'https://' + WORKER_NAME + '.' + subdomain.subdomain + '.workers.dev';

    // Recusar sobrepor um Worker alheio ou reexecutar esta instalação numa API já ativa.
    const existing = await cloudflare(base + '/workers/scripts/' + WORKER_NAME + '/settings', { allowNotFound:true });
    if (existing) {
      requireSetup(Array.isArray(existing.bindings), 'worker_ownership_unverified');
      requireSetup(existing.bindings.some(b => b.name === 'TIME_SAVER_REPOSITORY_ID'
        && b.type === 'plain_text' && b.text === repositoryId), 'worker_ownership_unverified');
      requireSetup(existing.bindings.some(b => b.name === 'MAIL_ENABLED'
        && b.type === 'plain_text' && b.text === 'false'), 'worker_already_live');
    }

    const databases = await cloudflare(base + '/d1/database?name=' + DATABASE_NAME + '&per_page=100');
    requireSetup(Array.isArray(databases) && databases.length < 100, 'database_list_invalid');
    const matches = databases.filter(db => db.name === DATABASE_NAME);
    requireSetup(matches.length <= 1, 'database_selection_required');
    let db = matches[0];
    if (db) {
      requireSetup(UUID.test(db.uuid), 'database_id_invalid');
      db = await cloudflare(base + '/d1/database/' + db.uuid);
    } else {
      db = await cloudflare(base + '/d1/database', {
        method:'POST', body:{ name:DATABASE_NAME, jurisdiction:'eu' }
      });
    }
    requireSetup(UUID.test(db?.uuid) && db.jurisdiction === 'eu', 'database_jurisdiction_unverified');

    const config = {
      name:WORKER_NAME, account_id:accountId, main:'dist/server/index.js',
      compatibility_date:'2026-11-01', workers_dev:true, preview_urls:false,
      observability:{ enabled:false },
      vars:{ PUBLIC_ORIGIN:FRONTEND_ORIGIN, API_ONLY:'true', MAIL_ENABLED:'false', LEGAL_READY:'false',
        HSTS_ENABLED:'false', MAIL_TO:'timesaverautomate@gmail.com',
        MAIL_FROM:'Time Saver <pedidos@timesaverautomate.com>', TIME_SAVER_REPOSITORY_ID:repositoryId },
      d1_databases:[{ binding:'DB', database_name:DATABASE_NAME, database_id:db.uuid, migrations_dir:'migrations' }],
      triggers:{ crons:['17 * * * *'] }
    };
    await saveConfig(config);
    const cliEnv = { CLOUDFLARE_ACCOUNT_ID:accountId, CLOUDFLARE_API_TOKEN:apiToken };
    await command(['d1','migrations','apply',DATABASE_NAME,'--remote'], { env:cliEnv });
    const schema = await cloudflare(base + '/d1/database/' + db.uuid + '/query', {
      method:'POST', body:{ sql:"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('security_state','submission_locks')" }
    });
    const tables = new Set(Array.isArray(schema) ? schema.flatMap(item =>
      item.success === true && Array.isArray(item.results) ? item.results.map(row => row.name) : []) : []);
    requireSetup(tables.has('security_state') && tables.has('submission_locks'), 'database_schema_unverified');
    await command(['deploy'], { env:cliEnv });

    const secrets = await cloudflare(base + '/workers/scripts/' + WORKER_NAME + '/secrets');
    requireSetup(Array.isArray(secrets), 'secret_metadata_invalid');
    const payload = { RESEND_API_KEY:env.RESEND_API_KEY };
    if (!secrets.some(secret => secret.name === 'SECURITY_HMAC_KEY' && secret.type === 'secret_text')) {
      const key = generateKey();
      requireSetup(/^[a-f0-9]{64}$/.test(key), 'generated_key_invalid');
      mask(key);
      payload.SECURITY_HMAC_KEY = key;
    }
    // Os segredos seguem por stdin. Não entram em argumentos, ficheiros ou artefactos.
    await command(['secret','bulk'], { env:cliEnv, input:JSON.stringify(payload) });
    const installedSecrets = await cloudflare(base + '/workers/scripts/' + WORKER_NAME + '/secrets');
    requireSetup(Array.isArray(installedSecrets) && ['RESEND_API_KEY','SECURITY_HMAC_KEY'].every(name =>
      installedSecrets.some(secret => secret.name === name && secret.type === 'secret_text')), 'secrets_unverified');

    const response = await fetcher(backendOrigin + '/api/form-status', {
      headers:{ Origin:FRONTEND_ORIGIN }, redirect:'error', signal:AbortSignal.timeout(20_000)
    });
    const status = await response.json();
    requireSetup(response.status === 200 && status.available === false
      && response.headers.get('Access-Control-Allow-Origin') === FRONTEND_ORIGIN
      && response.headers.get('X-Frame-Options') === 'DENY', 'disabled_api_verification_failed');
    const denied = await fetcher(backendOrigin + '/api/form-status', {
      headers:{ Origin:'https://untrusted.invalid' }, redirect:'error', signal:AbortSignal.timeout(20_000)
    });
    requireSetup(denied.status === 403 && !denied.headers.has('Access-Control-Allow-Origin'), 'origin_verification_failed');
    return { installed:true, operational:false, backendOrigin, code:'disabled_backend_verified' };
  } catch (error) {
    // Nunca copiar mensagens do fornecedor, saídas do CLI ou valores de configuração para logs.
    return { installed:false, operational:false, backendOrigin,
      code:error instanceof SetupError ? error.code : 'installation_or_verification_failed',
      ...(error instanceof SetupError && Number.isInteger(error.httpStatus)
        ? {httpStatus:error.httpStatus,operation:error.operation} : {}) };
  }
}
