import test from 'node:test';
import assert from 'node:assert/strict';
import {issueDiagnosticToken,validDiagnosticToken,issueRateProbeToken,validRateProbeToken} from '../src/security.mjs';
import {handleContact} from '../src/contact.mjs';

const NOW=1794384000000,ORIGIN='https://timesaverautomate.com';
const SESSION='c8323672-8ae0-4f89-b631-e074c493574c';
const KEY='re_test_only_not_a_real_key';
function fixture(){
  const calls=[];
  const env={FORM_ENABLED:'true',QUOTE_CRM_ENABLED:'true',RESEND_API_KEY:KEY,
    SECURITY_HMAC_KEY:'test-only-'.repeat(9),GOOGLE_SERVICE_ACCOUNT_JSON:'unused-in-invalid-probe',
    FORM_IP_RATE:{limit:async({key})=>{calls.push(key);return {success:true};}},
    FORM_EDGE_RATE:{limit:async()=>{throw Error('invalid_probe_reached_global_send_limit');}},
    FORM_TOKEN_RATE:{limit:async()=>({success:true})}};
  const request=(probe,{ip='192.0.2.123',origin=ORIGIN,colo='LIS'}={})=>{
    const request=new Request(ORIGIN+'/api/quote',{method:'POST',body:'{}',headers:{Origin:origin,
      'Content-Type':'application/json','Idempotency-Key':'5b8474ef-a118-4ab1-905e-9f0999c79320',
      'CF-Connecting-IP':ip,...(probe?{'X-Time-Saver-Rate-Probe':probe}:{})}});
    Object.defineProperty(request,'cf',{value:{colo}});return request;
  };
  return {env,calls,request};
}

test('prova de rate usa capacidade distinta, sessão estável e validade curta',async()=>{
  const env={RESEND_API_KEY:KEY};
  const probe=await issueRateProbeToken(env,NOW,SESSION),diagnostic=await issueDiagnosticToken(env,NOW);
  assert.equal(probe.split('.')[1],SESSION);assert.equal(await validRateProbeToken(probe,env,NOW),true);
  assert.equal(await validRateProbeToken(probe,env,NOW+60000),true);
  assert.equal(await validRateProbeToken(probe,env,NOW+60001),false);
  assert.equal(await validRateProbeToken(probe,env,NOW-5001),false);
  assert.equal(await validRateProbeToken(diagnostic,env,NOW),false);
  assert.equal(await validDiagnosticToken(probe,env,NOW),false);
  assert.equal(await validRateProbeToken(probe,{RESEND_API_KEY:'re_'+'a'.repeat(32)},NOW),false);
  assert.equal(probe.includes(KEY),false);
  await assert.rejects(issueRateProbeToken(env,NOW,'not-a-uuid'),/rate_probe_input_invalid/);
});

test('pedido assinado mede exatamente o mesmo bucket da submissão pública e nunca chega a fornecedores',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  t.mock.method(globalThis,'fetch',()=>{throw Error('probe_must_not_call_providers');});
  const f=fixture();
  const plain=await handleContact(f.request(),f.env),signed=await handleContact(f.request(await issueRateProbeToken(f.env,NOW,SESSION)),f.env);
  assert.equal(plain.status,422);assert.equal(signed.status,422);
  assert.deepEqual(await plain.json(),await signed.json());assert.equal(f.calls.length,2);
  assert.equal(f.calls[0],f.calls[1]);assert.match(f.calls[0],/^[a-f0-9]{64}$/);
  assert.equal(plain.headers.has('X-Time-Saver-Rate-Source'),false);
  assert.match(signed.headers.get('X-Time-Saver-Rate-Source'),/^[a-f0-9]{32}$/);
  assert.equal(signed.headers.get('X-Time-Saver-Rate-Colo'),'LIS');
  assert.equal(signed.headers.get('Cache-Control'),'no-store');
});

test('impressão por sessão permite verificar renovação e identifica mudança de origem sem expor IP',async t=>{
  t.mock.method(Date,'now',()=>NOW+40000);
  const f=fixture();
  const first=await handleContact(f.request(await issueRateProbeToken(f.env,NOW,SESSION)),f.env);
  const renewed=await handleContact(f.request(await issueRateProbeToken(f.env,NOW+40000,SESSION)),f.env);
  const differentSession=await handleContact(f.request(await issueRateProbeToken(f.env,NOW+40000)),f.env);
  const changedSource=await handleContact(f.request(await issueRateProbeToken(f.env,NOW+40000,SESSION),{ip:'192.0.2.124'}),f.env);
  const fingerprint=first.headers.get('X-Time-Saver-Rate-Source');
  assert.equal(renewed.headers.get('X-Time-Saver-Rate-Source'),fingerprint);
  assert.notEqual(differentSession.headers.get('X-Time-Saver-Rate-Source'),fingerprint);
  assert.notEqual(changedSource.headers.get('X-Time-Saver-Rate-Source'),fingerprint);
  assert.equal(fingerprint.includes('192.0.2.'),false);
});

test('assinatura inválida, expirada ou de outro diagnóstico não divulga impressão',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const f=fixture();const correct=await issueRateProbeToken(f.env,NOW,SESSION);
  for(const token of ['bad',correct.slice(0,-1)+(correct.endsWith('0')?'1':'0'),
    await issueRateProbeToken(f.env,NOW-60001,SESSION),await issueDiagnosticToken(f.env,NOW)]){
    const response=await handleContact(f.request(token),f.env);assert.equal(response.status,422);
    assert.equal(response.headers.has('X-Time-Saver-Rate-Source'),false);
    assert.equal(response.headers.has('X-Time-Saver-Rate-Colo'),false);
  }
  const foreign=await handleContact(f.request(correct,{origin:'https://foreign.example'}),f.env);
  assert.equal(foreign.status,403);assert.equal(foreign.headers.has('X-Time-Saver-Rate-Source'),false);
});

test('resposta de bloqueio mantém 429/Retry-After e metadados apenas para executor autenticado',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const f=fixture();f.env.FORM_IP_RATE.limit=async({key})=>{f.calls.push(key);return {success:false};};
  const signed=await handleContact(f.request(await issueRateProbeToken(f.env,NOW,SESSION)),f.env);
  const plain=await handleContact(f.request(),f.env);
  assert.equal(signed.status,429);assert.equal(plain.status,429);assert.equal(signed.headers.get('Retry-After'),'60');
  assert.match(signed.headers.get('X-Time-Saver-Rate-Source'),/^[a-f0-9]{32}$/);
  assert.equal(plain.headers.has('X-Time-Saver-Rate-Source'),false);assert.equal(f.calls[0],f.calls[1]);
});
