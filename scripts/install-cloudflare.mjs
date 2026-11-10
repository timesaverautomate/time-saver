import { appendFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { bootstrapCloudflare, WRANGLER_VERSION } from './cloudflare-bootstrap.mjs';

const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const runId = process.env.GITHUB_RUN_ID;
const token = process.env.GITHUB_TOKEN;
if (process.env.GITHUB_REPOSITORY_ID !== '1452563434' || repository !== 'timesaverautomate/time-saver'
  || process.env.GITHUB_REF !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(sha || '')
  || !/^\d+$/.test(runId || '') || !token) {
  console.error('Execute a instalação pelo workflow autorizado da Time Saver em main.');
  process.exit(1);
}
async function report(state, description) {
  const response = await fetch('https://api.github.com/repos/' + repository + '/statuses/' + sha, {
    method:'POST', redirect:'error', signal:AbortSignal.timeout(10_000),
    headers:{ Authorization:'Bearer ' + token, Accept:'application/vnd.github+json',
      'Content-Type':'application/json', 'X-GitHub-Api-Version':'2022-11-28' },
    body:JSON.stringify({ state, description, context:'time-saver/cloudflare-backend',
      target_url:'https://github.com/' + repository + '/actions/runs/' + runId })
  });
  if (!response.ok) throw new Error('status_unavailable');
}
const configPath = '.time-saver-cloudflare.json';
// Só o subprocesso Wrangler recebe o token Cloudflare; não recebe o token GitHub/Resend.
function command(args, options) {
  return new Promise((resolve,reject) => {
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/(?:TOKEN|SECRET|PASSWORD|API_KEY|HMAC)/i.test(key)));
    const child = spawn('npx', ['--yes','--package=wrangler@' + WRANGLER_VERSION,'--','wrangler',
      ...args,'--config',configPath], {
      env:{ ...childEnv, ...options.env, CI:'true', WRANGLER_SEND_METRICS:'false',
        WRANGLER_WRITE_LOGS:'false', WRANGLER_LOG_SANITIZE:'true',
        CLOUDFLARE_API_BASE_URL:'https://api.cloudflare.com/client/v4',
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false' }, stdio:['pipe','ignore','ignore']
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('cli_timeout')); },180_000);
    child.on('error',() => { clearTimeout(timer); reject(new Error('cli_unavailable')); });
    child.on('close',code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('cli_failed')); });
    child.stdin.on('error',() => {});
    child.stdin.end(options.input || '');
  });
}
try {
  await report('pending','A preparar instalação da API desativada na Cloudflare.');
} catch {
  console.error('Não foi possível registar o início da instalação. Nenhum recurso foi solicitado.');
  process.exit(1);
}
const result = await bootstrapCloudflare({
  env:process.env, command,
  saveConfig:config => writeFile(configPath,JSON.stringify(config,null,2) + '\n',{mode:0o600}),
  mask:value => console.log('::add-mask::' + value)
});
await rm(configPath,{force:true});
console.log(JSON.stringify(result,null,2));
const description = result.installed ? 'API instalada e verificada; envio permanece desativado.'
  : result.code === 'missing_cloudflare_token' ? 'Falta guardar CLOUDFLARE_API_TOKEN nos segredos Actions.'
  : 'Instalação pendente: ' + result.code;
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
  '## Backend Time Saver\n\n' + description + '\n\n' + (result.backendOrigin || '')
  + '\n\nO formulário comercial não está operacional. Não foram alterados DNS, planos ou faturação.\n');
try { await report(result.installed ? 'success' : 'failure',description); }
catch { console.error('Não foi possível registar o estado final.'); process.exitCode=1; }
if (!result.installed) process.exitCode=1;
