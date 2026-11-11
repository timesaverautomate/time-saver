import test from 'node:test';
import assert from 'node:assert/strict';
import {issueDiagnosticToken,validDiagnosticToken,keyedHash} from '../src/security.mjs';
import {handleContact} from '../src/contact.mjs';
import {QUOTE_HEADERS} from '../src/quote-sheets.mjs';
import {checkQuoteHealth} from '../scripts/check-quote-health.mjs';

const ORIGIN='https://timesaverautomate.com';
const NOW=1794384000000;
const KEY='re_test_only_not_a_real_key';
function fixture(){
  const calls=[];
  const env={FORM_ENABLED:'true',QUOTE_CRM_ENABLED:'true',RESEND_API_KEY:KEY,
    SECURITY_HMAC_KEY:'test-only-'.repeat(9),GOOGLE_SERVICE_ACCOUNT_JSON:'synthetic-only',
    FORM_IP_RATE:{limit:async({key})=>{calls.push({type:'ip',key});return {success:true};}},
    FORM_TOKEN_RATE:{limit:async()=>{calls.push({type:'token'});return {success:true};}},
    FORM_EDGE_RATE:{limit:async()=>{calls.push({type:'global'});return {success:true};}}};
  const request=(token,extra={})=>new Request(ORIGIN+'/api/quote-crm-health',{
    method:extra.method||'GET',headers:{'CF-Connecting-IP':'192.0.2.1',
      ...(token?{'X-Time-Saver-Diagnostic':token}:{}),...(extra.headers||{})}});
  return {env,calls,request};
}
function noGoogle(t){
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('unexpected_google_call');});
  return ()=>calls;
}

test('assinatura usa chave derivada e namespace dedicado; aceita apenas janela de 60 segundos',async()=>{
  const env={RESEND_API_KEY:KEY},token=await issueDiagnosticToken(env,NOW),parts=token.split('.');
  assert.match(token,/^\d{13}\.[a-f0-9-]{36}\.[a-f0-9]{64}$/);
  const derived=await keyedHash(KEY,'time-saver-diagnostic-key-v1');
  assert.equal(parts[2],await keyedHash(derived,'quote-crm-health-v1:'+parts[0]+'.'+parts[1]));
  assert.equal(token.includes(KEY),false);
  assert.equal(await validDiagnosticToken(token,env,NOW),true);
  assert.equal(await validDiagnosticToken(token,env,NOW+60000),true);
  assert.equal(await validDiagnosticToken(token,env,NOW+60001),false);
  assert.equal(await validDiagnosticToken(token,env,NOW-5000),true);
  assert.equal(await validDiagnosticToken(token,env,NOW-5001),false);
});

test('token ausente, adulterado, expirado, futuro e chave errada falham sem Google nem contadores',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const f=fixture(),google=noGoogle(t),valid=await issueDiagnosticToken(f.env,NOW);
  const changed=valid.slice(0,-1)+(valid.endsWith('0')?'1':'0');
  for(const token of [undefined,'invalid',changed,await issueDiagnosticToken(f.env,NOW-60001),
    await issueDiagnosticToken(f.env,NOW+5001),await issueDiagnosticToken({RESEND_API_KEY:'re_'+'x'.repeat(32)},NOW)]){
    const response=await handleContact(f.request(token),f.env);
    assert.equal(response.status,403);assert.deepEqual(await response.json(),{ready:false});
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  assert.equal(google(),0);assert.equal(f.calls.length,0);
});

test('método/origem inválidos e configuração desativada não chamam Google',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const f=fixture(),google=noGoogle(t),token=await issueDiagnosticToken(f.env,NOW);
  for(const extra of [{method:'POST'},{headers:{Origin:'https://invalid.example'}},{headers:{'Sec-Fetch-Site':'cross-site'}}]){
    assert.equal((await handleContact(f.request(token,extra),f.env)).status,403);
  }
  for(const changed of [{QUOTE_CRM_ENABLED:'false'},{FORM_ENABLED:'false'},{SECURITY_HMAC_KEY:''},{FORM_IP_RATE:null}]){
    const response=await handleContact(f.request(token),{...f.env,...changed});
    assert.equal(response.status,503);assert.equal((await response.json()).ready,false);
  }
  assert.equal(google(),0);assert.equal(f.calls.length,0);
});

test('limite do diagnóstico tem bucket separado e termina antes de qualquer chamada Google',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const f=fixture(),google=noGoogle(t),token=await issueDiagnosticToken(f.env,NOW);
  f.env.FORM_IP_RATE.limit=async({key})=>{f.calls.push({type:'ip',key});return {success:false};};
  const response=await handleContact(f.request(token),f.env);
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');
  assert.deepEqual(await response.json(),{ready:false,code:'crm_health_rate_limited'});
  assert.equal(f.calls.length,1);assert.match(f.calls[0].key,/^diagnostic:[a-f0-9]{64}$/);
  assert.equal(f.calls[0].key.includes('192.0.2.1'),false);assert.equal(google(),0);
});

test('assinatura válida autoriza apenas OAuth e leitura Sheets simulados, sem devolver linhas ou contagens',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const f=fixture(),destinations=[];
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const der=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
  let binary='';for(const byte of der)binary+=String.fromCharCode(byte);
  f.env.GOOGLE_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',client_email:'synthetic@example.invalid',
    private_key:'-----BEGIN PRIVATE KEY-----\n'+btoa(binary)+'\n-----END PRIVATE KEY-----',
    token_uri:'https://oauth2.googleapis.com/token'});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const host=new URL(url).hostname;destinations.push({host,method:options.method||'GET'});
    if(host==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-access-token'});
    if(host==='sheets.googleapis.com')return Response.json({values:[QUOTE_HEADERS,['synthetic-row-not-to-return']]});
    throw Error('unexpected_destination');
  });
  const response=await handleContact(f.request(await issueDiagnosticToken(f.env,NOW)),f.env);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ready:true});
  assert.deepEqual(destinations,[{host:'oauth2.googleapis.com',method:'POST'},{host:'sheets.googleapis.com',method:'GET'}]);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].type,'ip');
});

test('configuração de assinatura inválida falha fechada e formato de token é estrito',async()=>{
  const env={RESEND_API_KEY:KEY},token=await issueDiagnosticToken(env,NOW),parts=token.split('.');
  for(const value of ['',null,'not-a-key','re_short','re_'+'x'.repeat(257)]){
    await assert.rejects(issueDiagnosticToken({RESEND_API_KEY:value},NOW),/diagnostic_configuration_invalid/);
    assert.equal(await validDiagnosticToken(token,{RESEND_API_KEY:value},NOW),false);
  }
  for(const invalid of [null,token+'x',token.replace(parts[1],parts[1].replace('-4','-1')),token.replace(parts[2],parts[2].toUpperCase())]){
    assert.equal(await validDiagnosticToken(invalid,env,NOW),false);
  }
});

test('checker assina o header e filtra resposta; falta de chave não gera pedido',async()=>{
  const env={RESEND_API_KEY:KEY};let calls=0;
  const result=await checkQuoteHealth({env,fetcher:async(url,options)=>{
    calls++;assert.equal(url,ORIGIN+'/api/quote-crm-health');
    assert.equal(await validDiagnosticToken(options.headers['X-Time-Saver-Diagnostic'],env),true);
    assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
    return Response.json({ready:true,rows:[['must-not-be-returned']],token:'must-not-be-returned'});
  }});
  assert.deepEqual(result,{ready:true});assert.equal(calls,1);
  assert.deepEqual(await checkQuoteHealth({env:{},fetcher:()=>{throw Error('unexpected');}}),{ready:false,code:'crm_health_configuration_missing'});
});

test('checker não divulga tokens, credenciais ou detalhes de falhas e códigos arbitrários',async()=>{
  const env={RESEND_API_KEY:KEY};
  assert.deepEqual(await checkQuoteHealth({env,fetcher:async()=>Response.json({ready:false},{status:403})}),{ready:false,code:'crm_health_http_403'});
  assert.deepEqual(await checkQuoteHealth({env,fetcher:async()=>{throw Error(KEY);}}),{ready:false,code:'crm_health_unavailable'});
  assert.deepEqual(await checkQuoteHealth({env,fetcher:async()=>Response.json({ready:false,code:KEY})}),{ready:false,code:'crm_health_not_ready'});
  assert.deepEqual(await checkQuoteHealth({env,fetcher:async()=>Response.json({ready:false,code:'sheets_auth_failed'})}),{ready:false,code:'sheets_auth_failed'});
});
