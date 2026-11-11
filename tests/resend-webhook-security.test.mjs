import test from 'node:test';
import assert from 'node:assert/strict';
import webhook, { verifySvix, verifySvixDetailed, readWebhookBody, WebhookBodyError, planCrmEvent, writePlannedCrmCells, googleToken, checkCrm, CrmEventCoordinator } from '../workers/resend-webhook.js';

const NOW = 1794384000000;
const SECRET = 'whsec_' + btoa('synthetic-webhook-key-for-tests!!');
const encoder = new TextEncoder();
const URL = 'https://webhook.example.invalid/webhooks/resend';
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

async function signedHeaders(body, { now = NOW, id = 'msg_synthetic_test', secret = SECRET } = {}) {
  const timestamp = String(Math.floor(now / 1000));
  const bytes = Uint8Array.from(atob(secret.slice(6)), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${timestamp}.${body}`)));
  const signature = btoa(String.fromCharCode(...digest));
  return new Headers({ 'content-type': 'application/json', 'svix-id': id,
    'svix-timestamp': timestamp, 'svix-signature': 'v1,' + signature });
}
async function requestFor(body, options = {}) {
  return new Request(URL, { method: 'POST', headers: await signedHeaders(body, options), body });
}

test('assinatura UTF-8 produzida pelo SDK oficial Svix é compatível', async () => {
  // Vetor sintético gerado com svix Python 1.99.1; não é uma credencial real.
  const body = '{"type":"email.delivered","data":{"email_id":"ficticio-123","nota":"Olá, automação!"}}';
  const headers = new Headers({ 'svix-id': 'msg_sdk_compatibility', 'svix-timestamp': String(NOW / 1000),
    'svix-signature': 'v1,Rh/ljPXFoxFmKNWm2YPzNUiATWqHiTSlO3CBKbpWJ3k=' });
  assert.equal(await verifySvix(body, headers, SECRET, NOW), true);
  assert.equal(await verifySvix(body.replace('Olá', 'Outro texto'), headers, SECRET, NOW), false);
});

test('limites anunciados e codificação são recusados antes de abrir o corpo', async () => {
  for (const [headers, expected] of [[{ 'content-length': '65537' }, 413],
    [{ 'content-length': '-1' }, 413], [{ 'content-length': 'invalid' }, 413],
    [{ 'content-length': '9'.repeat(100) }, 413], [{ 'content-encoding': 'gzip' }, 415]]) {
    let reads = 0;
    const request = { url: URL, method: 'POST', headers: new Headers(headers),
      body: { getReader() { reads++; throw Error('must_not_open_reader'); } } };
    const response = await webhook.fetch(request, {});
    assert.equal(response.status, expected); assert.equal(reads, 0);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('fragmento ou fluxo excessivo sem Content-Length termina com 413 e cancela sem aguardar', async t => {
  t.mock.method(Date, 'now', () => NOW);
  for (const chunks of [[new Uint8Array(65537)], [new Uint8Array(32768), new Uint8Array(32769)]]) {
    let index = 0, cancelled = 0, released = 0;
    const headers = await signedHeaders('{}');
    const request = { url: URL, method: 'POST', headers, body: { getReader: () => ({
      read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
      cancel: () => { cancelled++; return new Promise(() => {}); },
      releaseLock: () => { released++; }
    }) } };
    const response = await webhook.fetch(request, { RESEND_WEBHOOK_SECRET: SECRET });
    assert.equal(response.status, 413); assert.deepEqual(await response.json(), { error: 'too_large' });
    assert.equal(cancelled, 1); assert.equal(released, 1); assert.equal(index, chunks.length);
  }
});

test('deadline total não reinicia com fragmentos e cancelamento bloqueado não prende a rejeição', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let completeRead, reads = 0, cancelled = 0, released = 0, result;
  const reader = {
    read() { reads++; return new Promise(resolve => { completeRead = resolve; }); },
    cancel() { cancelled++; return new Promise(() => {}); },
    releaseLock() { released++; }
  };
  const pending = readWebhookBody({ headers: new Headers(), body: { getReader: () => reader } }, { timeoutMs: 5 })
    .then(value => { result = value; }, error => { result = error; });
  await flush(); t.mock.timers.tick(4);
  completeRead({ done: false, value: encoder.encode('{') }); await flush();
  assert.equal(reads, 2); t.mock.timers.tick(1); await flush();
  assert.ok(result instanceof WebhookBodyError); assert.equal(result.status, 408);
  assert.equal(result.message, 'body_timeout'); assert.equal(cancelled, 1); assert.equal(released, 1);
  await pending;
});

test('UTF-8 inválido é recusado e JSON inválido assinado não causa erro interno', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const bad = new Request(URL, { method: 'POST', headers: await signedHeaders('{}'), body: new Uint8Array([0xc3, 0x28]) });
  const response = await webhook.fetch(bad, { RESEND_WEBHOOK_SECRET: SECRET });
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'invalid_body' });
  const invalidJSON = await webhook.fetch(await requestFor('{'), { RESEND_WEBHOOK_SECRET: SECRET });
  assert.equal(invalidJSON.status, 400); assert.deepEqual(await invalidJSON.json(), { error: 'invalid_json' });
});

test('assinatura e segredo malformados falham fechados sem ler o corpo ou divulgar detalhes', async t => {
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(console, 'warn', () => {});
  for (const secret of [undefined, null, 42, {}, '', 'whsec_', 'whsec_test', 'whsec_' + 'A'.repeat(300)]) {
    let reads = 0;
    const request = { url: URL, method: 'POST', headers: await signedHeaders('{}'),
      body: { getReader() { reads++; throw Error('private_internal_details'); } } };
    const response = await webhook.fetch(request, { RESEND_WEBHOOK_SECRET: secret });
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'unauthorized' });
    assert.equal(reads, 0);
    assert.equal(await verifySvix('{}', request.headers, secret, NOW), false);
  }
  const valid = await signedHeaders('{}');
  for (const [name, value] of [['svix-id', 'x'.repeat(201)], ['svix-timestamp', '1'.repeat(100)],
    ['svix-timestamp', String(NOW / 1000 - 301)], ['svix-timestamp', String(NOW / 1000 + 301)],
    ['svix-signature', 'x'.repeat(1025)]]) {
    const headers = new Headers(valid); headers.set(name, value);
    assert.equal(await verifySvix('{}', headers, SECRET, NOW), false);
  }
});

test('diagnóstico detalhado preserva categorias seguras e entradas limitadas sem devolver material assinado', async () => {
  const headers = await signedHeaders('{}');
  const changed = (name, value) => { const copy = new Headers(headers); copy.set(name, value); return copy; };
  const cases = [
    ['{}', new Headers(), SECRET, 'missing_headers'],
    ['{}', headers, {}, 'secret_missing_or_invalid_format'],
    ['{}', headers, 'whsec_%%%%', 'invalid_secret_encoding'],
    ['{}', changed('svix-timestamp', 'x'.repeat(10000)), SECRET, 'invalid_timestamp'],
    ['{}', changed('svix-timestamp', String(NOW / 1000 - 301)), SECRET, 'timestamp_outside_5_min_window'],
    ['{}', changed('svix-id', 'x'.repeat(201)), SECRET, 'invalid_header_format'],
    ['{}', changed('svix-signature', 'x'.repeat(1025)), SECRET, 'invalid_signature_format'],
    ['{}', { get() { throw Error('private_internal_error'); } }, SECRET, 'missing_headers'],
    ['x'.repeat(65537), headers, SECRET, 'signature_mismatch'],
    ['changed body', headers, SECRET, 'signature_mismatch']
  ];
  for (const [body, inputHeaders, secret, reason] of cases) {
    const result = await verifySvixDetailed(body, inputHeaders, secret, NOW);
    assert.deepEqual(result, { valid: false, reason });
    assert.deepEqual(Object.keys(result).sort(), ['reason', 'valid']);
  }
  assert.deepEqual(await verifySvixDetailed('{}', headers, SECRET, NOW), { valid: true, reason: 'verified' });
});

test('diagnóstico do proprietário mantém console.warn apenas com categoria anónima', async t => {
  t.mock.method(Date, 'now', () => NOW); const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const headers = await signedHeaders('{}', { id: 'msg_private_header_token' });
  const privateBody = '{"private_body_token":"never_log_this"}';
  const missing = await webhook.fetch(new Request(URL, { method: 'POST', body: '{}' }), { RESEND_WEBHOOK_SECRET: SECRET });
  const unconfigured = await webhook.fetch(new Request(URL, { method: 'POST', headers, body: '{}' }), {});
  const mismatch = await webhook.fetch(new Request(URL, { method: 'POST', headers, body: privateBody }), { RESEND_WEBHOOK_SECRET: SECRET });
  assert.equal(missing.status, 401); assert.equal(unconfigured.status, 401); assert.equal(mismatch.status, 401);
  assert.deepEqual(warnings, [
    ['resend_webhook_verification_failed', 'missing_headers'],
    ['resend_webhook_verification_failed', 'secret_missing_or_invalid_format'],
    ['resend_webhook_verification_failed', 'signature_mismatch']
  ]);
  const logged = JSON.stringify(warnings);
  for (const value of [SECRET, privateBody, headers.get('svix-id'), headers.get('svix-signature'), headers.get('svix-timestamp')]) {
    assert.equal(logged.includes(value), false);
  }
});

test('conteúdo adulterado, assinatura falsa e assinatura de evento expirado são rejeitados', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const headers = await signedHeaders('{}');
  assert.equal(await verifySvix('{"changed":true}', headers, SECRET, NOW), false);
  const falseHeaders = new Headers(headers); falseHeaders.set('svix-signature', 'v1,' + btoa('x'.repeat(32)));
  assert.equal(await verifySvix('{}', falseHeaders, SECRET, NOW), false);
  assert.equal(await verifySvix('{}', headers, SECRET, NOW + 300000), true);
  assert.equal(await verifySvix('{}', headers, SECRET, NOW + 300001), false);
  const rotated = new Headers(headers); rotated.set('svix-signature', 'v1,' + btoa('x'.repeat(32)) + ' ' + headers.get('svix-signature'));
  assert.equal(await verifySvix('{}', rotated, SECRET, NOW), true);
});

test('assinatura válida mantém dry-run e ignora tipos desconhecidos sem rede ou escrita', async t => {
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(globalThis, 'fetch', () => { throw Error('webhook_must_not_call_any_provider'); });
  const env = { RESEND_WEBHOOK_SECRET: SECRET, RESEND_WEBHOOK_WRITE_ENABLED: 'true', CRM_COORDINATOR: { idFromName: () => 'test-id', get: () => ({ fetch: async () => new Response(JSON.stringify({ accepted:true, mode:'dry_run', crm_writes_enabled:false, crm_check:'credentials_missing' }), {status:200}) }) } };
  const event = JSON.stringify({ type: 'email.delivered', data: { email_id: 'synthetic-message-id' } });
  const response = await webhook.fetch(await requestFor(event), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true, mode: 'dry_run', crm_writes_enabled: false, crm_check: 'credentials_missing' });
  const ignored = await webhook.fetch(await requestFor(JSON.stringify({ type: 'unknown.type' })), env);
  assert.deepEqual(await ignored.json(), { accepted: true, ignored: true });
  for (const id of ['', 'x'.repeat(201), 'line\nbreak']) {
    const invalid = await webhook.fetch(await requestFor(JSON.stringify({ type: 'email.sent', data: { email_id: id } })), env);
    assert.equal(invalid.status, 400); assert.deepEqual(await invalid.json(), { error: 'missing_email_id' });
  }
});

test('64 KiB exatos são permitidos; rotas e health mantêm o contrato sem guardar respostas', async () => {
  const payload = 'x'.repeat(65536);
  assert.equal(await readWebhookBody(new Request(URL, { method: 'POST', body: payload })), payload);
  const health = await webhook.fetch(new Request('https://webhook.example.invalid/health'), {});
  assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ok', sending_enabled: false, crm_writes_enabled: false });
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal((await webhook.fetch(new Request(URL), {})).status, 404);
});

test('CRM read-only planning matches message IDs and refuses duplicates', () => {
  const header = Array(26).fill(''); header[22] = 'ID mensagem Resend';
  const row = Array(26).fill(''); row[22] = 'test-id'; row[21] = 'Enviado'; row[24] = 'Não';
  const event = { type: 'email.bounced', data: { email_id: 'test-id' } };
  assert.deepEqual(planCrmEvent([header,row],event),{matched:true,planned_cells:2,updates:[{range:"'Pedidos'!V2",values:[['Bounce']]},{range:"'Pedidos'!Y2",values:[['Sim']]}]});
  assert.deepEqual(planCrmEvent([header,row],{type:'email.delivered',data:{email_id:'other'}}),{matched:false,planned_cells:0,updates:[]});
  assert.throws(()=>planCrmEvent([header,row,row],event),/duplicate_message_id/);
  const blocked = [...row]; blocked[21]='Bounce'; blocked[24]='Sim';
  assert.deepEqual(planCrmEvent([header,blocked],{type:'email.delivered',data:{email_id:'test-id'}}),{matched:true,planned_cells:0,updates:[]});
});

test('CRM rejects late sent events after delivery and only plans narrow cells', () => {
 const header=Array(26).fill(''); header[22]='ID mensagem Resend';
 const row=Array(26).fill(''); row[22]='id-1'; row[21]='Entregue';
 assert.deepEqual(planCrmEvent([header,row],{type:'email.sent',data:{email_id:'id-1'}}),
   {matched:true,planned_cells:0,updates:[]});
 const delayed={...row}; delayed[21]='Entrega atrasada';
 assert.deepEqual(planCrmEvent([header,delayed],{type:'email.delivered',data:{email_id:'id-1'}}).updates,
   [{range:"'Pedidos'!V2",values:[['Entregue']]}]);
});

test('webhook fails closed without coordinator binding', async t => {
 t.mock.method(Date,'now',()=>NOW);
 const body=JSON.stringify({type:'email.delivered',data:{email_id:'test-id'}});
 const res=await webhook.fetch(await requestFor(body),{RESEND_WEBHOOK_SECRET:SECRET});
 assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{error:'coordinator_unavailable'});
});

test('CRM write adapter rejects unsafe ranges without contacting Google', async () => {
 const forbidden = [
   [{range:"'Pedidos'!A2",values:[['changed']]}],
   [{range:"'Pedidos'!Y2",values:[['Não']]}],
   [{range:"'Pedidos'!V1",values:[['Entregue']]}],
   [{range:"'Pedidos'!V2",values:[['Entregue']]},{range:"'Pedidos'!Y3",values:[['Sim']]}],
   [{range:"'Pedidos'!V2",values:[['Entregue']]},{range:"'Pedidos'!V2",values:[['Bounce']]}],
 ];
 for(const updates of forbidden)
   await assert.rejects(writePlannedCrmCells("not-a-key",updates,()=>{throw Error("network_called")}),/invalid_crm_updates/);
 assert.deepEqual(await writePlannedCrmCells("not-a-key",[]),{written_cells:0});
});

let credentialsPromise;
function syntheticGoogleCredentials() {
  credentialsPromise ??= (async()=>{
    const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
      publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
    const bytes=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
    return JSON.stringify({type:'service_account',client_email:'synthetic@example.invalid',
      private_key:'-----BEGIN PRIVATE KEY-----\n'+btoa(String.fromCharCode(...bytes))+'\n-----END PRIVATE KEY-----'});
  })();
  return credentialsPromise;
}
function crmRows(id='synthetic-message-id',status='Enviado') {
  const header=Array(26).fill('');header[22]='ID mensagem Resend';
  const row=Array(26).fill('');row[22]=id;row[21]=status;row[24]='Não';
  return [header,row];
}
const coordinatorRequest=event=>new Request('https://internal.invalid/internal/check',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event)});
const deliveredEvent={type:'email.delivered',data:{email_id:'synthetic-message-id'}};
const fixtureEvent={type:'email.delivered',data:{email_id:'01a1ca94-4663-7eee-93bc-6fd01eccf4f4'}};

test('OAuth, leitura e escrita Google têm prazo de 12 segundos e recusam seguir redirecionamentos',async t=>{
  const credentials=await syntheticGoogleCredentials(),calls=[],timeouts=[];
  t.mock.method(AbortSignal,'timeout',milliseconds=>{
    timeouts.push(milliseconds);return new AbortController().signal;
  });
  const http=async(url,options)=>{
    calls.push({url,options});assert.equal(options.redirect,'manual');
    assert.ok(options.signal instanceof AbortSignal);
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-google-token'});
    if(url.endsWith('/values:batchUpdate'))return Response.json({totalUpdatedCells:1});
    return Response.json({values:crmRows()});
  };
  const plan=await checkCrm(credentials,deliveredEvent,http,true);
  assert.equal(plan.updates.length,1);
  assert.deepEqual(await writePlannedCrmCells(credentials,plan.updates,http),{written_cells:1});
  assert.equal(calls.length,4);assert.deepEqual(timeouts,[12000,12000,12000,12000]);
  assert.equal(new Set(calls.map(call=>call.options.signal)).size,4);
  assert.ok(calls.every(call=>['oauth2.googleapis.com','sheets.googleapis.com'].includes(new globalThis.URL(call.url).hostname)));
});

test('OAuth rejeita tokens não textuais, vazios, excessivos ou com espaços/controlos',async()=>{
  const credentials=await syntheticGoogleCredentials();
  for(const access_token of [undefined,null,{},[],true,7,'',' ','x\r\ny','x\u0085y','x'.repeat(4097)]){
    await assert.rejects(googleToken(credentials,async()=>Response.json({access_token})),/google_auth_failed/);
  }
  assert.equal(await googleToken(credentials,async()=>Response.json({access_token:'synthetic.google-token_1~'})),
    'synthetic.google-token_1~');
});

test('redirecionamentos de OAuth e Sheets falham sem enviar credenciais a outro destino',async()=>{
  const credentials=await syntheticGoogleCredentials();
  for(const operation of ['oauth','read','write']){
    const calls=[];
    const http=async(url,options)=>{
      calls.push(url);assert.equal(options.redirect,'manual');
      if(operation!=='oauth'&&url==='https://oauth2.googleapis.com/token')
        return Response.json({access_token:'synthetic-google-token'});
      return new Response(null,{status:302,headers:{location:'https://attacker.example.invalid/collect'}});
    };
    if(operation==='oauth')await assert.rejects(googleToken(credentials,http),/google_auth_failed/);
    else if(operation==='read')await assert.rejects(checkCrm(credentials,deliveredEvent,http),/google_sheet_read_failed/);
    else await assert.rejects(writePlannedCrmCells(credentials,[{range:"'Pedidos'!V2",values:[['Entregue']]}],http),/google_sheet_write_failed/);
    assert.equal(calls.length,operation==='oauth'?1:2);
    assert.ok(calls.every(url=>!url.includes('attacker')));
  }
});

test('um email entregue ignora falha ou atraso antigos sem alterar prioridades Bounce/Spam',()=>{
  const rows=crmRows('synthetic-message-id','Entregue');
  for(const type of ['email.sent','email.delivery_delayed','email.failed']){
    assert.deepEqual(planCrmEvent(rows,{type,data:{email_id:'synthetic-message-id'}}),
      {matched:true,planned_cells:0,updates:[]});
  }
  for(const [type,next] of [['email.bounced','Bounce'],['email.complained','Spam']]){
    const plan=planCrmEvent(rows,{type,data:{email_id:'synthetic-message-id'}});
    assert.deepEqual(plan.updates,[{range:"'Pedidos'!V2",values:[[next]]},{range:"'Pedidos'!Y2",values:[['Sim']]}]);
  }
  for(const current of ['Bounce','Spam','Cancelou subscrição']){
    assert.deepEqual(planCrmEvent(crmRows('synthetic-message-id',current),{type:'email.failed',data:{email_id:'synthetic-message-id'}}),
      {matched:true,planned_cells:0,updates:[]});
  }
});

test('eventos assinados repetem falhas do writer ativo e preservam erros e dry-run do proprietário',async t=>{
  t.mock.method(Date,'now',()=>NOW);t.mock.method(console,'warn',()=>{});
  for(const [event,flags,credentials,expected] of [
    [deliveredEvent,{RESEND_CRM_GENERAL_WRITE_ENABLED:'true'},'invalid-json',503],
    [fixtureEvent,{RESEND_WEBHOOK_WRITE_ENABLED:'true'},'invalid-json',503],
    [fixtureEvent,{RESEND_WEBHOOK_WRITE_ENABLED:'true'},undefined,503],
    [deliveredEvent,{RESEND_CRM_GENERAL_WRITE_ENABLED:'true'},undefined,503],
    [deliveredEvent,{RESEND_WEBHOOK_WRITE_ENABLED:'true'},'invalid-json',200],
    [{...fixtureEvent,type:'email.sent'},{RESEND_WEBHOOK_WRITE_ENABLED:'true'},'invalid-json',200],
    [fixtureEvent,{},'invalid-json',200],
    [deliveredEvent,{},undefined,200]
  ]){
    const coordinator=new CrmEventCoordinator({}, {...flags,GOOGLE_SERVICE_ACCOUNT_JSON:credentials});
    const env={RESEND_WEBHOOK_SECRET:SECRET,CRM_COORDINATOR:{idFromName:()=> 'local-only',get:()=>coordinator}};
    const result=await webhook.fetch(await requestFor(JSON.stringify(event)),env);
    const body=await result.json();assert.equal(result.status,expected);
    const intentionalDryRun=expected===200&&credentials===undefined;
    assert.equal(body.accepted,intentionalDryRun);assert.equal(body.crm_writes_enabled,false);
    assert.equal(body.mode,intentionalDryRun?'dry_run':'error');
    if(expected===503)assert.equal(body.error,'crm_write_unavailable');
  }
});

test('falhas de escrita ativa são repetíveis sem detalhes privados na resposta ou nos logs',async t=>{
  const credentials=await syntheticGoogleCredentials(),warnings=[];
  t.mock.method(console,'warn',(...args)=>warnings.push(args));
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options});
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-google-token'});
    if(url.endsWith('/values:batchUpdate'))throw Error('private-provider-and-credential-detail');
    return Response.json({values:crmRows()});
  });
  const coordinator=new CrmEventCoordinator({}, {GOOGLE_SERVICE_ACCOUNT_JSON:credentials,RESEND_CRM_GENERAL_WRITE_ENABLED:'true'});
  const result=await coordinator.fetch(coordinatorRequest(deliveredEvent));
  assert.equal(result.status,503);
  assert.deepEqual(await result.json(),{accepted:false,mode:'error',crm_writes_enabled:false,crm_check:'crm_check_failed',error:'crm_write_unavailable'});
  assert.deepEqual(warnings,[['resend_crm_coordinator_check_failed','crm_check_failed']]);
  assert.equal(calls.filter(call=>call.url.endsWith('/values:batchUpdate')).length,1);
});

test('a leitura bloqueada aborta e liberta a fila para o evento seguinte',async t=>{
  const credentials=await syntheticGoogleCredentials(),controllers=[];
  let reading,reads=0;
  const started=new Promise(resolve=>{reading=resolve;});
  t.mock.method(console,'warn',()=>{});
  t.mock.method(AbortSignal,'timeout',milliseconds=>{
    assert.equal(milliseconds,12000);const controller=new AbortController();controllers.push(controller);return controller.signal;
  });
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-google-token'});
    reads++;
    if(reads===1)return new Promise((resolve,reject)=>{
      options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});reading(options.signal);
    });
    return Response.json({values:[crmRows()[0]]});
  });
  const coordinator=new CrmEventCoordinator({}, {GOOGLE_SERVICE_ACCOUNT_JSON:credentials,RESEND_CRM_GENERAL_WRITE_ENABLED:'true'});
  const first=coordinator.fetch(coordinatorRequest(deliveredEvent));
  const blockedSignal=await started;
  const next=coordinator.fetch(coordinatorRequest(deliveredEvent));
  controllers.find(controller=>controller.signal===blockedSignal).abort(new DOMException('Synthetic timeout','TimeoutError'));
  assert.equal((await first).status,503);
  const recovered=await next;assert.equal(recovered.status,200);
  assert.equal((await recovered.json()).matched,false);assert.equal(reads,2);
});

test('dry-run conserva diagnóstico do proprietário e nunca ativa a escrita preparada',async t=>{
  const credentials=await syntheticGoogleCredentials(),calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options});
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-google-token'});
    if(url.endsWith('/values:batchUpdate'))throw Error('dry-run-must-not-write');
    return Response.json({values:crmRows()});
  });
  const coordinator=new CrmEventCoordinator({}, {GOOGLE_SERVICE_ACCOUNT_JSON:credentials,RESEND_WEBHOOK_WRITE_ENABLED:'true'});
  const result=await coordinator.fetch(coordinatorRequest(deliveredEvent));
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{accepted:true,mode:'dry_run',crm_writes_enabled:false,crm_check:'ok',matched:true,planned_cells:1,
    diagnostic:{write_flag_enabled:true,fixture_eligible:false,general_write_enabled:false}});
  assert.equal(calls.length,2);assert.ok(calls.every(call=>!call.url.endsWith('/values:batchUpdate')));
});

test('o writer de fixture conserva o ID e V26 exatos e repete escritas incompletas',async t=>{
  const credentials=await syntheticGoogleCredentials(),writes=[];
  let rowNumber=26,complete=true;
  t.mock.method(console,'warn',()=>{});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-google-token'});
    if(url.endsWith('/values:batchUpdate')){
      writes.push(JSON.parse(options.body));return Response.json({totalUpdatedCells:complete?1:0});
    }
    const [header,row]=crmRows(fixtureEvent.data.email_id);
    const rows=[header,...Array.from({length:rowNumber-1},()=>Array(26).fill(''))];rows[rowNumber-1]=row;
    return Response.json({values:rows});
  });
  const coordinator=new CrmEventCoordinator({}, {GOOGLE_SERVICE_ACCOUNT_JSON:credentials,RESEND_WEBHOOK_WRITE_ENABLED:'true'});
  const result=await coordinator.fetch(coordinatorRequest(fixtureEvent));
  assert.equal(result.status,200);assert.equal((await result.json()).mode,'fixture_write');
  assert.deepEqual(writes,[{valueInputOption:'RAW',data:[{range:"'Pedidos'!V26",values:[['Entregue']]}]}]);
  rowNumber=25;
  const wrongRow=await coordinator.fetch(coordinatorRequest(fixtureEvent));
  assert.equal(wrongRow.status,200);assert.equal((await wrongRow.json()).mode,'dry_run');assert.equal(writes.length,1);
  rowNumber=26;complete=false;
  const incomplete=await coordinator.fetch(coordinatorRequest(fixtureEvent));
  assert.equal(incomplete.status,503);
  assert.deepEqual(await incomplete.json(),{accepted:false,mode:'error',crm_writes_enabled:false,
    crm_check:'google_sheet_write_incomplete',error:'crm_write_unavailable'});
});

test('o modo read-only preserva a resposta 503 do proprietário perante falha transitória',async t=>{
  const credentials=await syntheticGoogleCredentials();
  t.mock.method(console,'warn',()=>{});
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:'synthetic-only'},{status:503}));
  const coordinator=new CrmEventCoordinator({}, {GOOGLE_SERVICE_ACCOUNT_JSON:credentials});
  const result=await coordinator.fetch(coordinatorRequest(deliveredEvent));
  assert.equal(result.status,503);
  assert.deepEqual(await result.json(),{accepted:false,mode:'error',crm_writes_enabled:false,crm_check:'google_auth_failed'});
});
