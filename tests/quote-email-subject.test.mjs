import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handleContact,issueContactToken,parseContactToken,quoteEmailSubject} from '../src/contact.mjs';
import {keyedHash} from '../src/security.mjs';

const NOW=1794390000000,REF='TS-ABCDEF0123456789ABCD';
const KEY='5b8474ef-a118-4ab1-905e-9f0999c79320';
const NONCE='c8323672-8ae0-4f89-b631-e074c493574c';
function fixture(){
  const calls=[],limiter={limit:async()=>({success:true})};
  const env={FORM_ENABLED:'true',RESEND_API_KEY:'re_test_only_not_a_real_key',SECURITY_HMAC_KEY:'test-only-'.repeat(9),
    FORM_IP_RATE:limiter,FORM_TOKEN_RATE:limiter,FORM_EDGE_RATE:limiter};
  const request=(data,key=KEY)=>new Request('https://timesaverautomate.com/api/quote',{method:'POST',
    headers:{Origin:'https://timesaverautomate.com','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1','Idempotency-Key':key},body:JSON.stringify(data)});
  const send=async(data,key=KEY)=>handleContact(request(data,key),env,async(url,options)=>{
    calls.push({url,options,message:JSON.parse(options.body)});return Response.json({id:'synthetic-only'});
  });
  const data=token=>({name:'Ana d’Ávila',email:'synthetic@example.invalid',
    description:'Pedido sintético para testar a compatibilidade do assunto sem dados de clientes.',token});
  return {env,calls,send,data};
}
async function legacyToken(env,created=NOW-2000){
  const value=created+'.'+NONCE;return value+'.'+await keyedHash(env.SECURITY_HMAC_KEY,'contact-ticket:'+value);
}
test('tickets antigos conservam exatamente a mensagem Resend publicada, incluindo assunto e chave',async t=>{
  t.mock.method(Date,'now',()=>NOW);const f=fixture(),token=await legacyToken(f.env);
  assert.equal((await parseContactToken(token,f.env)).subjectVersion,1);
  const response=await f.send(f.data(token));assert.equal(response.status,200);
  const expected=JSON.parse(await readFile(new URL('fixtures/quote-email-v1.json',import.meta.url),'utf8'));
  assert.equal(f.calls[0].options.body,JSON.stringify(expected));
  const fingerprint=await keyedHash(f.env.SECURITY_HMAC_KEY,'contact-send:'+NONCE+':'+KEY);
  assert.equal(f.calls[0].options.headers['Idempotency-Key'],'time-saver-contact/'+fingerprint);
});
test('ticket novo tem versão autenticada e nome no início, texto fixo compatível e referência no fim',async t=>{
  t.mock.method(Date,'now',()=>NOW);const f=fixture(),token=await issueContactToken(f.env,NOW-2000);
  const ticket=await parseContactToken(token,f.env);assert.equal(ticket.subjectVersion,2);
  assert.equal((await parseContactToken(await legacyToken(f.env),f.env)).subjectVersion,1);
  const result=await (await f.send(f.data(token))).json();
  assert.equal(f.calls[0].message.subject,'Ana d’Ávila — Time Saver — Novo pedido de orçamento — '+result.reference);
  assert.deepEqual(f.calls[0].message.to,['timesaverautomate@gmail.com']);
  assert.equal(f.calls[0].message.reply_to,'synthetic@example.invalid');
});
test('repetição é estável e pedidos diferentes do mesmo nome têm assuntos e referências distintos',async t=>{
  t.mock.method(Date,'now',()=>NOW);const f=fixture(),data=f.data(await issueContactToken(f.env,NOW-2000));
  const first=await (await f.send(data)).json();const repeated=await (await f.send(data)).json();
  assert.deepEqual(first,repeated);assert.equal(f.calls[0].options.body,f.calls[1].options.body);
  assert.equal(f.calls[0].options.headers['Idempotency-Key'],f.calls[1].options.headers['Idempotency-Key']);
  const second=await (await f.send(data,'a501ca79-5547-4fb3-bb98-81d64a84e764')).json();
  assert.notEqual(second.reference,first.reference);assert.notEqual(f.calls[2].message.subject,f.calls[0].message.subject);
  assert.ok(f.calls[2].message.subject.startsWith(data.name+' — '));
});
test('versões novas e antigas respeitam a validade de 23 horas e recusam MAC adulterado',async t=>{
  t.mock.method(Date,'now',()=>NOW);const f=fixture(),age=23*60*60*1000;
  for(const mint of [created=>legacyToken(f.env,created),created=>issueContactToken(f.env,created)]){
    assert.ok(await parseContactToken(await mint(NOW-age),f.env));
    assert.equal(await parseContactToken(await mint(NOW-age-1),f.env),null);
    const token=await mint(NOW-2000);assert.equal(await parseContactToken(token.slice(0,-1)+(token.endsWith('0')?'1':'0'),f.env),null);
  }
});
test('validação do nome impede injeção CRLF sem contactar Resend',async t=>{
  t.mock.method(Date,'now',()=>NOW);const f=fixture(),data=f.data(await issueContactToken(f.env,NOW-2000));
  for(const name of ['Ana\r\nBcc: attacker@example.invalid','Ana\nSubject: substituted']){
    const response=await f.send({...data,name});assert.equal(response.status,422);
  }
  assert.equal(f.calls.length,0);
});
test('assunto remove controlos e invisíveis, preserva nomes Unicode e limita comprimento',()=>{
  assert.equal(quoteEmailSubject('  Ana d’Ávila  ',REF),'Ana d’Ávila — Time Saver — Novo pedido de orçamento — '+REF);
  const sanitized=quoteEmailSubject('Ana\r\n\u0085\u2028\u2029\u202e\u2066Silva',REF);
  assert.equal(sanitized,'Ana Silva — Time Saver — Novo pedido de orçamento — '+REF);
  assert.doesNotMatch(sanitized,/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u);
  assert.ok(quoteEmailSubject('x'.repeat(1000),REF).startsWith('x'.repeat(100)+' — '));
  assert.ok(quoteEmailSubject('\u202e\u2066',REF).startsWith('Pedido do sítio — '));
  assert.throws(()=>quoteEmailSubject('Ana','TS-invalid\r\nBcc:bad'),/contact_subject_invalid/);
});
test('nome semelhante a um teste técnico mantém o marcador comercial que exclui arquivo automático',()=>{
  const subject=quoteEmailSubject('Time Saver — Teste técnico de envio',REF);
  assert.ok(subject.includes('Time Saver — Novo pedido de orçamento'));
  assert.ok(subject.includes('Novo pedido de orçamento'));
});
