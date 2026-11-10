import test from 'node:test';
import assert from 'node:assert/strict';
import { testEmailConnection } from '../scripts/test-email.mjs';
const options = {apiKey:'re_only_for_diagnostic_unit_tests',now:new Date('2026-11-10T12:00:00Z')};

test('diagnóstico não envia sem segredo válido',async()=>{
  for (const apiKey of [undefined,'','invalid','re_value\r\nheader']) {
    let called=false;
    const result=await testEmailConnection({apiKey,transport:async()=>{called=true;throw new Error();}});
    assert.equal(result.accepted,false);assert.equal(called,false);
  }
});
test('diagnóstico tem destinatário fixo e nova tentativa com corpo e chave estáveis',async()=>{
  const calls=[];
  const transport=async(url,config)=>{
    calls.push({url,config});return new Response(JSON.stringify({id:'test-provider-id'}),{status:200});
  };
  const first=await testEmailConnection({...options,transport});
  const second=await testEmailConnection({...options,now:new Date('2026-11-10T23:59:59Z'),transport});
  assert.equal(first.accepted,true);assert.equal(first.inboxDeliveryConfirmed,false);
  assert.equal(second.reference,first.reference);
  assert.equal(calls[0].url,'https://api.resend.com/emails');
  assert.equal(calls[0].config.body,calls[1].config.body);
  assert.equal(calls[0].config.headers['Idempotency-Key'],calls[1].config.headers['Idempotency-Key']);
  const body=JSON.parse(calls[0].config.body);
  assert.deepEqual(body.to,['timesaverautomate@gmail.com']);
  assert.equal(body.from,'Time Saver <onboarding@resend.dev>');assert.equal('html' in body,false);
  assert.equal(JSON.stringify(first).includes(options.apiKey),false);
});
test('diagnóstico rejeita erros HTTP e respostas sem identificador',async()=>{
  for (const status of [200,400,401,403,429,500]) {
    const result=await testEmailConnection({...options,transport:async()=>new Response('{}',{status})});
    assert.equal(result.accepted,false);
  }
});
test('diagnóstico oculta detalhes internos perante falha de rede',async()=>{
  const result=await testEmailConnection({...options,transport:async()=>{throw new Error(options.apiKey);}});
  assert.equal(result.accepted,false);assert.equal(JSON.stringify(result).includes(options.apiKey),false);
});
