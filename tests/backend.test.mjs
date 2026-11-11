import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import { issueFormToken } from '../src/security.mjs';
import { takeRate, cleanupSecurity, claimSubmission } from '../src/store.mjs';
import { validateSubmission, validEmail } from '../src/validation.mjs';
import { composeEmail, deliveryConfigured } from '../src/mail.mjs';
import { testEnv, quoteData, createTestDB } from './helpers.mjs';

async function quoteRequest(env,overrides={},options={}) {
  const data = {...quoteData(),token:await issueFormToken(env,Date.now()-2_000),...overrides};
  return new Request('https://timesaver.test/api/quote',{
    method:'POST',headers:{'Content-Type':'application/json','Origin':env.PUBLIC_ORIGIN,'CF-Connecting-IP':'192.0.2.8',
      'Sec-Fetch-Site':'same-origin','Idempotency-Key':options.key || crypto.randomUUID(),...options.headers},
    body:options.raw || JSON.stringify(data)
  });
}
async function withMail(transport,run) {
  const previous = globalThis.fetch;
  globalThis.fetch = transport;
  try { await run(); } finally { globalThis.fetch = previous; }
}
const accepted = () => new Response(JSON.stringify({id:'fake-provider-acceptance'}),{status:200});

test('formulário desativado sem credenciais ou aprovação legal; nunca simula sucesso',async()=>{
  const env = testEnv(); delete env.RESEND_API_KEY;
  assert.equal(deliveryConfigured(env),false);
  let called=false;
  await withMail(async()=>{called=true;return accepted();},async()=>{
    const status=await worker.fetch(new Request('https://timesaver.test/api/form-status'),env);
    assert.equal((await status.json()).available,false);
    const response=await worker.fetch(await quoteRequest(env),env);
    assert.equal(response.status,503); assert.equal(called,false);
  });
  env.RESEND_API_KEY='re_only_a_unit_test_value';env.LEGAL_READY='false';
  assert.equal(deliveryConfigured(env),false);
});
test('pedido válido: cabeçalhos fixos, Reply-To validado, corpo de texto e idempotência',async()=>{
  const env=testEnv(); let calls=0; let submitted;
  await withMail(async(url,options)=>{
    calls++;assert.equal(url,'https://api.resend.com/emails');submitted=JSON.parse(options.body);
    assert.equal(options.headers['Idempotency-Key'].startsWith('TS-'),true);return accepted();
  },async()=>{
    const key=crypto.randomUUID();
    const response=await worker.fetch(await quoteRequest(env,{}, {key}),env);
    assert.equal(response.status,200);
    const payload=await response.json();assert.equal(payload.accepted,true);assert.match(payload.reference,/^TS-/);
    assert.deepEqual(submitted.to,[env.MAIL_TO]);assert.equal(submitted.from,env.MAIL_FROM);
    assert.equal(submitted.reply_to,'ana@empresa.test');assert.equal(submitted.subject,'Time Saver — Novo pedido de orçamento');
    assert.equal('html' in submitted,false);assert.match(submitted.text,/Data \(UTC\)/);assert.match(submitted.text,/Referência: TS-/);
    const repeat=await worker.fetch(await quoteRequest(env,{}, {key}),env);
    assert.equal((await repeat.json()).duplicate,true);
    const newKey=await worker.fetch(await quoteRequest(env),env);
    assert.equal((await newKey.json()).reference,payload.reference);assert.equal(calls,1);
    const row=env.DB.sqlite.prepare('SELECT * FROM submission_locks').get();
    const stored=JSON.stringify(row);
    assert.equal(stored.includes('Ana'),false);assert.equal(stored.includes('@empresa'),false);assert.equal(stored.includes('192.0.2'),false);
  });
});
test('validação do servidor rejeita dados inválidos, opções desconhecidas e destinatários injetados',async()=>{
  const env=testEnv();let calls=0;
  await withMail(async()=>{calls++;return accepted();},async()=>{
    for (const invalid of [
      {email:'ana@empresa.test\r\nBcc:injetado@evil.test'},
      {name:'A'}, {description:'curto'}, {service:'Serviço não permitido'}, {budget:'Grátis'},
      {deadline:'Amanhã'}, {tools:'x'.repeat(501)}, {name:['Ana']}, {to:'injetado@evil.test'}
    ]) {
      const response=await worker.fetch(await quoteRequest(env,invalid),env);
      // Isolar janelas de rate limit para testar o validador e não o limite.
      assert.equal(response.status,422);
      assert.ok(Object.keys((await response.json()).errors).length);
      env.DB.sqlite.exec('DELETE FROM security_state');
    }
    assert.equal(calls,0);
  });
});
test('rejeita origem externa, CSRF inválido, honeypot, tipo e tamanho do corpo',async()=>{
  const env=testEnv();let calls=0;
  await withMail(async()=>{calls++;return accepted();},async()=>{
    const cases=[
      [{},{headers:{Origin:'https://evil.test'}},403],
      [{},{headers:{'Sec-Fetch-Site':'cross-site'}},403],
      [{},{headers:{Origin:''}},403],
      [{token:'invalid'},{},403],
      [{website:'https://spam.test'},{},400],
      [{},{headers:{'Content-Type':'text/plain'}},415],
      [{},{raw:'{bad json'},400],
      [{},{raw:JSON.stringify({description:'x'.repeat(17_000)})},413]
    ];
    for (const [data,options,status] of cases) {
      const response=await worker.fetch(await quoteRequest(env,data,options),env);
      assert.equal(response.status,status);
    }
    assert.equal(calls,0);
  });
});
test('token assinado exige tempo mínimo e expira; não exige cookies',async()=>{
  const env=testEnv();
  const response=await worker.fetch(new Request('https://timesaver.test/api/form-status',{headers:{'CF-Connecting-IP':'192.0.2.8'}}),env);
  const status=await response.json();
  assert.equal(status.available,true);assert.ok(status.token);assert.equal(response.headers.has('Set-Cookie'),false);
  const tooFast=await worker.fetch(await quoteRequest(env,{token:await issueFormToken(env)}),env);
  assert.equal(tooFast.status,403);
  const expired=await worker.fetch(await quoteRequest(env,{token:await issueFormToken(env,Date.now()-7_300_000)}),env);
  assert.equal(expired.status,403);
});
test('falha e timeout do fornecedor mantêm referência e permitem retry idempotente',async()=>{
  const env=testEnv();let calls=0;const payloads=[];const keys=[];
  await withMail(async(_url,options)=>{
    calls++;payloads.push(options.body);keys.push(options.headers['Idempotency-Key']);
    if(calls===1)throw new Error('timeout with internal secret');
    return accepted();
  },async()=>{
    const key=crypto.randomUUID();
    const failed=await worker.fetch(await quoteRequest(env,{}, {key}),env);
    assert.equal(failed.status,502);assert.equal((await failed.text()).includes('internal secret'),false);
    const retried=await worker.fetch(await quoteRequest(env,{}, {key}),env);
    assert.equal(retried.status,200);assert.equal((await retried.json()).accepted,true);
    assert.equal(keys[0],keys[1]);assert.equal(payloads[0],payloads[1]);assert.equal(calls,2);
  });
});
test('HTTP de erro ou aceitação sem ID do fornecedor nunca são sucesso',async()=>{
  for(const status of [200,400,401,429,500]) {
    const env=testEnv();
    await withMail(async()=>new Response('{}',{status}),async()=>{
      const response=await worker.fetch(await quoteRequest(env),env);
      assert.equal(response.status,502);
      assert.notEqual((await response.json()).accepted,true);
    });
  }
});
test('submissões concorrentes do mesmo conteúdo originam apenas um envio',async()=>{
  const env=testEnv();let calls=0;let release;
  const waiting=new Promise(resolve=>{release=resolve;});
  await withMail(async()=>{calls++;await waiting;return accepted();},async()=>{
    const firstRequest=await quoteRequest(env);
    const first=worker.fetch(firstRequest,env);
    // Esperar pela posse do lock sem depender de pausas temporais.
    for(let i=0;i<40 && calls===0;i++)await new Promise(resolve=>setImmediate(resolve));
    const second=await worker.fetch(await quoteRequest(env),env);
    assert.equal(second.status,409);release();
    assert.equal((await first).status,200);assert.equal(calls,1);
  });
});
test('limites partilhados no SQLite e endpoint rejeitam excesso',async()=>{
  const db=createTestDB();const now=Date.now();
  const rates=await Promise.all(Array.from({length:40},()=>takeRate(db,'shared',8,now+60_000)));
  assert.equal(rates.filter(Boolean).length,8);
  const env=testEnv();
  for(let i=0;i<8;i++)assert.equal((await worker.fetch(await quoteRequest(env,{description:'curto'}),env)).status,422);
  const blocked=await worker.fetch(await quoteRequest(env,{description:'curto'}),env);
  assert.equal(blocked.status,429);assert.equal(blocked.headers.get('Retry-After'),'900');
});
test('chave reutilizada com conteúdo alterado é rejeitada e permite nova chave',async()=>{
  const env=testEnv();const key=crypto.randomUUID();
  await withMail(async()=>accepted(),async()=>{
    await worker.fetch(await quoteRequest(env,{}, {key}),env);
    const response=await worker.fetch(await quoteRequest(env,{name:'Outra pessoa'}, {key}),env);
    assert.equal(response.status,409);assert.equal((await response.json()).renewKey,true);
  });
});
test('limpeza remove estado expirado; não elimina locks válidos',async()=>{
  const db=createTestDB();const now=Date.now();
  await takeRate(db,'expired',1,now-1);await takeRate(db,'current',1,now+10_000);
  await claimSubmission(db,'expired-key','fp-expired',now-24*3_600_000);
  await claimSubmission(db,'current-key','fp-current',now);
  await cleanupSecurity(db,now);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM security_state').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM submission_locks').get().n,1);
});
test('HTML malicioso permanece texto no email e não é interpolado nas páginas',()=>{
  const data=quoteData();data.description='<img src=x onerror=alert(1)> Mais de trinta caracteres aqui.';
  assert.equal(Object.keys(validateSubmission(data).errors).length,0);
  const body=composeEmail(data,'TS-TEST',0);assert.ok(body.includes(data.description));
});
test('cabeçalhos de segurança e ausência de páginas de autenticação',async()=>{
  const env=testEnv();
  for(const path of ['/','/privacidade','/aviso-legal','/cookies']) {
    const response=await worker.fetch(new Request('https://timesaver.test'+path),env);
    assert.equal(response.status,200);assert.equal(response.headers.get('X-Frame-Options'),'DENY');
    assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
    assert.equal(response.headers.has('Set-Cookie'),false);assert.equal(response.headers.has('Strict-Transport-Security'),false);
  }
  env.HSTS_ENABLED='true';
  assert.equal((await worker.fetch(new Request('https://timesaver.test'),env)).headers.get('Strict-Transport-Security'),'max-age=31536000');
  for(const path of ['/login','/registo','/admin','/conta','/reset-password','/api/login'])assert.equal((await worker.fetch(new Request('https://timesaver.test'+path),env)).status,404);
});
test('sem dados de IP do edge ou com falha de DB, falha de forma fechada',async()=>{
  const env=testEnv();
  const missing=await worker.fetch(await quoteRequest(env,{}, {headers:{'CF-Connecting-IP':''}}),env);
  assert.equal(missing.status,503);
  env.DB={prepare(){throw new Error('database secret');},batch(){throw new Error('database secret');}};
  const failed=await worker.fetch(await quoteRequest(env),env);assert.equal(failed.status,503);
  assert.equal((await failed.text()).includes('database secret'),false);
});
test('email e conteúdo: limites, UTF-8 e validação de tipos',()=>{
  assert.equal(validEmail('nome@empresa.pt'),true);assert.equal(validEmail('x@a..pt'),false);
  assert.equal(validEmail('x@a.pt\r\nX-Test: yes'),false);
  assert.equal(validateSubmission(null).errors.form,'Pedido inválido.');
  assert.ok(validateSubmission({...quoteData(),description:'a'.repeat(4001)}).errors.description);
});
test('backend separado aceita apenas o preflight da origem exata e cabeçalhos previstos',async()=>{
  const env=testEnv();
  const request=new Request('https://api.timesaver.test/api/quote',{method:'OPTIONS',headers:{
    Origin:env.PUBLIC_ORIGIN,'Sec-Fetch-Site':'same-site',
    'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,idempotency-key'
  }});
  const response=await worker.fetch(request,env);
  assert.equal(response.status,204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),env.PUBLIC_ORIGIN);
  assert.equal(response.headers.has('Access-Control-Allow-Credentials'),false);
  for(const headers of [
    {Origin:'https://evil.test'},
    {'Access-Control-Request-Headers':'authorization'},
    {'Access-Control-Request-Method':'DELETE'}
  ]) {
    const changed=new Headers(request.headers);
    for(const [name,value] of Object.entries(headers))changed.set(name,value);
    const failed=await worker.fetch(new Request(request.url,{method:'OPTIONS',headers:changed}),env);
    assert.equal(failed.status,403);
  }
});
test('submissão entre frontend e API preserva validação, idempotência e ausência de cookies',async()=>{
  const env=testEnv();let calls=0;
  await withMail(async()=>{calls++;return accepted();},async()=>{
    const original=await quoteRequest(env);
    const headers=new Headers(original.headers);
    headers.set('Sec-Fetch-Site','same-site');
    const request=new Request('https://api.timesaver.test/api/quote',{method:'POST',headers,body:await original.text()});
    const first=await worker.fetch(request.clone(),env);
    const second=await worker.fetch(request.clone(),env);
    assert.equal(first.status,200);assert.equal((await second.json()).duplicate,true);
    assert.equal(first.headers.get('Access-Control-Allow-Origin'),env.PUBLIC_ORIGIN);
    assert.equal(first.headers.has('Set-Cookie'),false);assert.equal(calls,1);
  });
});
test('modo só API não publica a landing page e rejeita origem externa na emissão de tokens',async()=>{
  const env={...testEnv(),API_ONLY:'true'};
  assert.equal((await worker.fetch(new Request('https://api.timesaver.test/'),env)).status,404);
  const denied=await worker.fetch(new Request('https://api.timesaver.test/api/form-status',{headers:{
    Origin:'https://evil.test','Sec-Fetch-Site':'cross-site','CF-Connecting-IP':'192.0.2.8'
  }}),env);
  assert.equal(denied.status,403);assert.equal(denied.headers.has('Access-Control-Allow-Origin'),false);
  const allowed=await worker.fetch(new Request('https://api.timesaver.test/api/form-status',{headers:{
    Origin:env.PUBLIC_ORIGIN,'Sec-Fetch-Site':'same-site','CF-Connecting-IP':'192.0.2.8'
  }}),env);
  assert.equal(allowed.status,200);assert.equal((await allowed.json()).available,true);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),env.PUBLIC_ORIGIN);
});
