import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapCloudflare, WORKER_NAME, DATABASE_NAME, FRONTEND_ORIGIN } from '../scripts/cloudflare-bootstrap.mjs';

const accountId = 'a'.repeat(32);
const databaseId = '12345678-1234-4234-8234-123456789abc';
function environment() {
  return { GITHUB_REPOSITORY_ID:'1452563434', GITHUB_REPOSITORY:'timesaverautomate/time-saver',
    GITHUB_REF:'refs/heads/main', CLOUDFLARE_API_TOKEN:'unit-test-'.repeat(5),
    RESEND_API_KEY:'re_only_a_unit_test_value' };
}
function fixture({ existing = null, secrets = [], databases = [], accounts = [{id:accountId}],
  jurisdiction = 'eu', probeAvailable = false, leakOrigin = false, schemaValid = true } = {}) {
  const calls = [], commands = [], configs = [], masks = [];
  let activeSecrets = [...secrets];
  function json(result) { return Response.json({success:true,result}); }
  const fetcher = async (url, options = {}) => {
    calls.push({url,options});
    const path = new URL(url).pathname;
    if (path==='/client/v4/zones') return json([]);
    if (new URL(url).hostname !== 'api.cloudflare.com') {
      const origin = options.headers.Origin;
      if (origin !== FRONTEND_ORIGIN) return Response.json({available:false},{status:403,
        headers:leakOrigin ? {'Access-Control-Allow-Origin':'*'} : {}});
      return Response.json({available:probeAvailable},{headers:{
        'Access-Control-Allow-Origin':FRONTEND_ORIGIN,'X-Frame-Options':'DENY'
      }});
    }
    if (path === '/client/v4/accounts') return json(accounts);
    if (path.endsWith('/workers/subdomain')) return json({subdomain:'timesaverautomate'});
    if (path.endsWith('/settings')) return existing ? json(existing) : new Response('',{status:404});
    if (path.endsWith('/secrets')) return json(activeSecrets);
    if (path.endsWith('/query')) return json([{success:true,results:schemaValid
      ? [{name:'security_state'},{name:'submission_locks'}] : []}]);
    if (path.endsWith('/d1/database')) return options.method === 'POST'
      ? json({name:DATABASE_NAME,uuid:databaseId,jurisdiction}) : json(databases);
    if (path.endsWith('/d1/database/' + databaseId)) return json({name:DATABASE_NAME,uuid:databaseId,jurisdiction});
    throw new Error('unhandled_fixture_request');
  };
  return {calls,commands,configs,masks, options:{ env:environment(), fetcher,
    command:async (args,options) => {
      commands.push({args,options});
      if (args[0]==='secret') activeSecrets=[...activeSecrets,...Object.keys(JSON.parse(options.input))
        .map(name=>({name,type:'secret_text'}))];
    },
    saveConfig:async config => {configs.push(config);}, mask:value => masks.push(value),
    generateKey:() => 'b'.repeat(64) }};
}
const ownBindings = [
  {type:'plain_text',name:'TIME_SAVER_REPOSITORY_ID',text:'1452563434'},
  {type:'plain_text',name:'MAIL_ENABLED',text:'false'}
];

test('instalação não chama fornecedores sem segredos ou fora do repositório/main autorizados', async () => {
  for (const changed of [
    {CLOUDFLARE_API_TOKEN:''}, {RESEND_API_KEY:''},
    {GITHUB_REPOSITORY_ID:'1'}, {GITHUB_REPOSITORY:'other/repo'}, {GITHUB_REF:'refs/heads/other'}
  ]) {
    const f=fixture(); Object.assign(f.options.env,changed);
    const result=await bootstrapCloudflare(f.options);
    assert.equal(result.installed,false);
    assert.equal(f.calls.length,0);
    assert.equal(f.commands.length,0);
  }
});

test('instalação prepara apenas API desativada, D1 UE e segredos por stdin', async () => {
  const f=fixture(); const result=await bootstrapCloudflare(f.options);
  assert.equal(result.installed,true); assert.equal(result.operational,false);
  assert.equal(result.backendOrigin,'https://' + WORKER_NAME + '.timesaverautomate.workers.dev');
  const config=f.configs[0];
  assert.equal(config.vars.MAIL_ENABLED,'false'); assert.equal(config.vars.LEGAL_READY,'false');
  assert.equal(config.vars.API_ONLY,'true'); assert.equal(config.vars.PUBLIC_ORIGIN,FRONTEND_ORIGIN);
  assert.equal(config.vars.MAIL_TO,'timesaverautomate@gmail.com');
  assert.equal(config.observability.enabled,false);
  assert.equal(config.d1_databases[0].database_id,databaseId);
  assert.ok(!JSON.stringify(config).includes(f.options.env.RESEND_API_KEY));
  assert.ok(!JSON.stringify(config).includes(f.options.env.CLOUDFLARE_API_TOKEN));
  const creation=f.calls.find(c=>c.options.method==='POST');
  assert.deepEqual(JSON.parse(creation.options.body),{name:DATABASE_NAME,jurisdiction:'eu'});
  assert.deepEqual(f.commands.map(c=>c.args[0]),['d1','deploy','secret']);
  const payload=JSON.parse(f.commands[2].options.input);
  assert.equal(payload.RESEND_API_KEY,f.options.env.RESEND_API_KEY);
  assert.equal(payload.SECURITY_HMAC_KEY,'b'.repeat(64));
  assert.deepEqual(f.masks,['b'.repeat(64)]);
  assert.ok(!JSON.stringify(f.commands.map(c=>c.args)).includes(payload.RESEND_API_KEY));
});

test('reinstalação preserva a chave HMAC e reutiliza a base existente', async () => {
  const f=fixture({existing:{bindings:ownBindings},secrets:[{name:'SECURITY_HMAC_KEY',type:'secret_text'}],
    databases:[{name:DATABASE_NAME,uuid:databaseId}]});
  const result=await bootstrapCloudflare(f.options);
  assert.equal(result.installed,true);
  assert.equal(f.calls.filter(c=>c.options.method==='POST' && !c.url.endsWith('/query')).length,0);
  assert.deepEqual(JSON.parse(f.commands.at(-1).options.input),{RESEND_API_KEY:f.options.env.RESEND_API_KEY});
  assert.equal(f.masks.length,0);
});

test('instalação recusa escolher entre contas ou sobrepor Worker alheio/ativo', async () => {
  for (const setup of [
    {accounts:[{id:accountId},{id:'c'.repeat(32)}]},
    {existing:{bindings:[]}},
    {existing:{bindings:ownBindings.map(b=>b.name==='MAIL_ENABLED'?{...b,text:'true'}:b)}}
  ]) {
    const f=fixture(setup); const result=await bootstrapCloudflare(f.options);
    assert.equal(result.installed,false); assert.equal(f.commands.length,0);
    assert.equal(f.calls.filter(c=>c.options.method==='POST').length,0);
  }
});

test('instalação não reutiliza base fora da UE nem confirma uma API ativa ou CORS aberto', async () => {
  const invalidDB=fixture({jurisdiction:'us',databases:[{name:DATABASE_NAME,uuid:databaseId}]});
  assert.equal((await bootstrapCloudflare(invalidDB.options)).code,'database_jurisdiction_unverified');
  assert.equal(invalidDB.commands.length,0);
  const missingSchema=fixture({schemaValid:false});
  assert.equal((await bootstrapCloudflare(missingSchema.options)).code,'database_schema_unverified');
  assert.deepEqual(missingSchema.commands.map(c=>c.args[0]),['d1']);
  for (const setup of [{probeAvailable:true},{leakOrigin:true}]) {
    const f=fixture(setup); const result=await bootstrapCloudflare(f.options);
    assert.equal(result.installed,false); assert.equal(result.operational,false);
  }
});

test('falhas do fornecedor ou CLI não devolvem mensagens que possam conter segredos', async () => {
  const f=fixture();
  f.options.command=async()=>{throw new Error(f.options.env.RESEND_API_KEY);};
  const result=await bootstrapCloudflare(f.options);
  assert.equal(result.installed,false);
  assert.ok(!JSON.stringify(result).includes(f.options.env.RESEND_API_KEY));
  const provider=fixture();
  provider.options.fetcher=async()=>Response.json({success:false,errors:[{message:provider.options.env.CLOUDFLARE_API_TOKEN}]},{status:403});
  const denied=await bootstrapCloudflare(provider.options);
  assert.equal(denied.code,'cloudflare_access_or_request_failed');
  assert.ok(!JSON.stringify(denied).includes(provider.options.env.CLOUDFLARE_API_TOKEN));
});
