import test from 'node:test';
import assert from 'node:assert/strict';
import {handleContact,issueContactToken} from '../src/contact.mjs';
import {keyedHash} from '../src/security.mjs';
import {validateSubmission} from '../src/validation.mjs';
import {QUOTE_HEADERS,quoteRow} from '../src/quote-sheets.mjs';

test('handler real devolve 409 e renewKey perante payload diferente já registado, sem enviar Resend',async t=>{
  const now=1794384000000,key='12345678-1234-4234-8234-123456789abc';
  t.mock.method(Date,'now',()=>now);
  const limiter={limit:async()=>({success:true})};
  const env={FORM_ENABLED:'true',QUOTE_CRM_ENABLED:'true',RESEND_API_KEY:'re_test_only_not_a_real_key',
    SECURITY_HMAC_KEY:'test-only-'.repeat(9),FORM_IP_RATE:limiter,FORM_EDGE_RATE:limiter,FORM_TOKEN_RATE:limiter};
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const der=new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
  let binary='';for(const byte of der)binary+=String.fromCharCode(byte);
  env.GOOGLE_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',client_email:'synthetic@example.invalid',
    private_key:'-----BEGIN PRIVATE KEY-----\n'+btoa(binary)+'\n-----END PRIVATE KEY-----',
    token_uri:'https://oauth2.googleapis.com/token'});
  const token=await issueContactToken(env,now-2000);
  const input={name:'Teste de conflito',email:'synthetic@example.invalid',
    description:'Descrição atual do pedido, exclusivamente para um teste local.',token};
  const canonical=validateSubmission(input);assert.deepEqual(canonical.errors,{});
  const fingerprint=await keyedHash(env.SECURITY_HMAC_KEY,'contact-send:'+token.split('.')[1]+':'+key);
  const reference='TS-'+fingerprint.slice(0,20).toUpperCase();
  const previousDescription='Descrição anterior já registada para a mesma referência sintética.';
  const stored=quoteRow({...canonical.data,description:previousDescription},reference,now-1000);
  const googleCalls=[];let resendCalls=0;
  t.mock.method(globalThis,'fetch',async(raw,options={})=>{
    const url=new URL(raw);googleCalls.push({host:url.hostname,method:options.method||'GET'});
    if(url.href==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access'});
    if(url.hostname==='sheets.googleapis.com'&&url.pathname.includes('/values/')&&(options.method||'GET')==='GET'){
      return Response.json({values:[QUOTE_HEADERS,stored]});
    }
    throw Error('unexpected_mock_destination');
  });
  const request=new Request('https://timesaverautomate.com/api/quote',{method:'POST',headers:{
    Origin:'https://timesaverautomate.com','CF-Connecting-IP':'192.0.2.1',
    'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(input)});
  const response=await handleContact(request,env,async()=>{resendCalls++;throw Error('unexpected_resend');});
  const payload=await response.json();
  assert.equal(response.status,409);assert.equal(payload.renewKey,true);assert.equal(payload.accepted,undefined);
  assert.equal(response.headers.get('Retry-After'),'3');assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(resendCalls,0);
  assert.deepEqual(googleCalls,[{host:'oauth2.googleapis.com',method:'POST'},{host:'sheets.googleapis.com',method:'GET'}]);
  assert.equal(stored[13],previousDescription);
  assert.equal(JSON.stringify(payload).includes(previousDescription),false);
  assert.equal(JSON.stringify(payload).includes(env.RESEND_API_KEY),false);
  assert.equal(JSON.stringify(payload).includes('synthetic-access'),false);
});
