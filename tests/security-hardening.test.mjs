import test from 'node:test';
import assert from 'node:assert/strict';
import { handleContact,issueContactToken } from '../src/contact.mjs';
import { readBoundedJSON,BodyTimeoutError } from '../src/validation.mjs';

const ORIGIN='https://timesaverautomate.com';
const KEY='12345678-1234-4234-8234-123456789abc';
const encoder=new TextEncoder();
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

function fixture({ipAllowed=true,edgeAllowed=true}={}){
  const calls=[];
  const env={FORM_ENABLED:'true',RESEND_API_KEY:'re_test_only_not_a_real_key',
    SECURITY_HMAC_KEY:'test-only-'.repeat(9),
    FORM_IP_RATE:{limit:async()=>{calls.push('ip');return {success:ipAllowed};}},
    FORM_EDGE_RATE:{limit:async()=>{calls.push('global');return {success:edgeAllowed};}},
    FORM_TOKEN_RATE:{limit:async()=>({success:true})}};
  const transport=async()=>{calls.push('provider');return Response.json({id:'test-provider-id'});};
  const headers=()=>new Headers({Origin:ORIGIN,'CF-Connecting-IP':'192.0.2.10',
    'Content-Type':'application/json','Idempotency-Key':KEY});
  const request=(body,changedHeaders={})=>new Request(ORIGIN+'/api/quote',{method:'POST',
    headers:{...Object.fromEntries(headers()),...changedHeaders},
    body:encoder.encode(typeof body==='string'?body:JSON.stringify(body))});
  const validBody=async()=>({name:'Teste de segurança',email:'teste@example.com',
    description:'Pedido sintético para validar proteções, sem dados de clientes.',
    token:await issueContactToken(env,Date.now()-2000)});
  return {env,calls,transport,headers,request,validBody};
}

test('IP limitado termina antes do formato, chave, leitura do corpo e orçamento partilhado',async()=>{
  const f=fixture({ipAllowed:false});
  const request={url:ORIGIN+'/api/quote',method:'POST',headers:f.headers(),
    body:{getReader(){throw Error('O corpo limitado não deve ser lido.');}}};
  request.headers.set('Content-Type','text/plain');request.headers.delete('Idempotency-Key');
  const response=await handleContact(request,f.env,f.transport);
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');
  assert.deepEqual(f.calls,['ip']);
});

test('pedidos malformados, inválidos ou honeypot não consomem o limite partilhado nem enviam email',async()=>{
  const f=fixture(),valid=await f.validBody();
  const cases=[
    [f.request(valid,{'Content-Type':'text/plain'}),415],
    [f.request(valid,{'Idempotency-Key':'inválida'}),400],
    [f.request('{'),400],
    [f.request({}),422],
    [f.request({...valid,email:'inválido'}),422],
    [f.request({...valid,service:'opção não permitida'}),422],
    [f.request({...valid,website:'spam.example'}),400],
    [f.request({...valid,description:'x'.repeat(20000)}),413]
  ];
  for(const [request,status] of cases){
    const response=await handleContact(request,f.env,f.transport);
    assert.equal(response.status,status);assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  assert.deepEqual(f.calls,Array(cases.length).fill('ip'));
});

test('ticket inválido, adulterado, prematuro ou expirado solicita renovação sem consumir envios',async()=>{
  const f=fixture(),valid=await f.validBody();
  const tokens=['',valid.token.slice(0,-1)+'x',await issueContactToken(f.env),
    await issueContactToken(f.env,Date.now()-24*60*60*1000)];
  for(const token of tokens){
    const response=await handleContact(f.request({...valid,token}),f.env,f.transport);
    const result=await response.json();
    assert.equal(response.status,403);assert.equal(result.refreshToken,true);
    assert.equal(result.accepted,undefined);assert.doesNotMatch(result.message,/stack|HMAC|body_timeout/);
  }
  assert.deepEqual(f.calls,Array(tokens.length).fill('ip'));
});

test('apenas um pedido válido consome o limite partilhado, antes de contactar o fornecedor',async()=>{
  for(const allowed of [false,true]){
    const f=fixture({edgeAllowed:allowed});
    const response=await handleContact(f.request(await f.validBody()),f.env,f.transport);
    assert.equal(response.status,allowed?200:429);
    assert.deepEqual(f.calls,allowed?['ip','global','provider']:['ip','global']);
    if(allowed)assert.equal((await response.json()).accepted,true);
  }
});

test('deadline do corpo é absoluto mesmo com fragmentos e não aguarda um cancelamento bloqueado',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let pendingRead,cancelled=0,released=0,reads=0,result;
  const reader={
    read(){reads++;return new Promise(resolve=>{pendingRead=resolve;});},
    cancel(){cancelled++;return new Promise(()=>{});},
    releaseLock(){released++;}
  };
  const request={headers:new Headers(),body:{getReader:()=>reader}};
  const completed=readBoundedJSON(request,{timeoutMs:100}).then(
    value=>{result={value};},error=>{result={error};});
  t.mock.timers.tick(40);pendingRead({done:false,value:encoder.encode('{')});await flush();
  assert.equal(reads,2);
  t.mock.timers.tick(40);pendingRead({done:false,value:encoder.encode('"value":')});await flush();
  assert.equal(reads,3);
  t.mock.timers.tick(21);await flush();
  assert.ok(result?.error instanceof BodyTimeoutError,'O prazo inicial deve terminar aos 100 ms, apesar dos fragmentos aos 40 e 80 ms.');
  assert.equal(cancelled,1);assert.equal(released,1);await completed;
});

test('timeout do corpo devolve 408 sem detalhes internos, quota partilhada ou fornecedor',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();let readStarted,cancelled=0,released=0;
  const reading=new Promise(resolve=>{readStarted=resolve;});
  const request={url:ORIGIN+'/api/quote',method:'POST',headers:f.headers(),body:{getReader:()=>({
    read(){readStarted();return new Promise(()=>{});},
    cancel(){cancelled++;return new Promise(()=>{});},
    releaseLock(){released++;}
  })}};
  const completed=handleContact(request,f.env,f.transport);
  await reading;t.mock.timers.tick(8001);
  const response=await completed,result=await response.json();
  assert.equal(response.status,408);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.match(result.message,/campos foram mantidos/);assert.doesNotMatch(JSON.stringify(result),/body_timeout|stack|BodyTimeoutError/);
  assert.deepEqual(f.calls,['ip']);assert.equal(cancelled,1);assert.equal(released,1);
});
