import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {handleContact,issueContactToken,parseContactToken} from '../src/contact.mjs';
import {proxyFetch} from '../src/site-proxy.mjs';
import {readSiteModules} from '../scripts/deploy-site-domain.mjs';

const ORIGIN='https://timesaverautomate.com';
function fixture(){
  const calls=[],rateKeys=[];
  const limiter={limit:async({key})=>{rateKeys.push(key);return {success:true};}};
  const env={FORM_ENABLED:'true',RESEND_API_KEY:'re_test_only_not_a_real_key',SECURITY_HMAC_KEY:'test-only-'.repeat(9),
    FORM_IP_RATE:limiter,FORM_EDGE_RATE:limiter,FORM_TOKEN_RATE:limiter,HSTS_ENABLED:'true'};
  const transport=async(url,options)=>{calls.push({url,options});return Response.json({id:'provider-test-id'});};
  const request=(body,extra={})=>new Request(ORIGIN+'/api/quote',{method:'POST',headers:{
    Origin:ORIGIN,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',
    'Idempotency-Key':'12345678-1234-4234-8234-123456789abc',...extra},body:JSON.stringify(body)});
  const body=async()=>({name:'Teste técnico',email:'teste@example.com',description:'Pedido sintético para testar a triagem sem dados de clientes.',
    service:'Dashboards e relatórios',goal:'Poupar tempo',frequency:'Mensalmente',
    startingPoint:'Já existe um ficheiro ou processo',specifics:'Vendas por mês',
    token:await issueContactToken(env,Date.now()-2000)});
  return {env,calls,rateKeys,transport,request,body};
}
test('envio direto aceita apenas resposta positiva, envia texto e preserva destinatário e assunto fixos',async()=>{
  const f=fixture(),body=await f.body();body.description+=' <img src=x onerror=alert(1)>';
  const response=await handleContact(f.request(body),f.env,f.transport),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.accepted,true);assert.match(result.reference,/^TS-[A-F0-9]{20}$/);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const sent=JSON.parse(f.calls[0].options.body);
  assert.equal(f.calls[0].url,'https://api.resend.com/emails');assert.equal(f.calls[0].options.redirect,'manual');
  assert.deepEqual(sent.to,['timesaverautomate@gmail.com']);assert.equal(sent.from,'Time Saver <pedidos@timesaverautomate.com>');
  assert.equal(sent.reply_to,body.email);assert.equal(sent.subject,'Time Saver — Novo pedido de orçamento');assert.equal(sent.html,undefined);
  for(const value of [body.service,body.goal,body.frequency,body.startingPoint,body.specifics,body.description])assert.ok(sent.text.includes(value));
  assert.ok(f.rateKeys.every(key=>!key.includes('192.0.2.1')));
});
test('mesma tentativa produz idempotência e corpo estáveis, sem depender de armazenamento',async()=>{
  const f=fixture(),body=await f.body();
  const a=await (await handleContact(f.request(body),f.env,f.transport)).json();
  const b=await (await handleContact(f.request(body),f.env,f.transport)).json();
  assert.deepEqual(a,b);assert.equal(f.calls[0].options.body,f.calls[1].options.body);
  assert.equal(f.calls[0].options.headers['Idempotency-Key'],f.calls[1].options.headers['Idempotency-Key']);
  const modules=await readSiteModules();
  assert.deepEqual(Object.keys(modules).sort(),['contact.mjs','proxy.mjs','quote-sheets.mjs','security.mjs','validation.mjs']);
  assert.doesNotMatch(Object.values(modules).join('\n'),/env\.DB|\.prepare\(|console\.log|localStorage|sessionStorage/);
});
test('validação do servidor rejeita opções, cabeçalhos, campos extra, honeypot e pedidos excessivos',async()=>{
  const f=fixture(),base=await f.body();
  for(const [change,status] of [[{email:'teste@example.com\r\nBcc:x@example.com'},422],[{service:'inventado'},422],
    [{frequency:'inventada'},422],[{goal:'inventado'},422],[{startingPoint:'inventado'},422],
    [{to:'outro@example.com'},422],[{description:'curto'},422],[{specifics:'x'.repeat(501)},422],
    [{website:'spam.example'},400],[{description:'x'.repeat(20000)},413]]){
    assert.equal((await handleContact(f.request({...base,...change}),f.env,f.transport)).status,status);
  }
  assert.equal(f.calls.length,0);
});
test('origem, contexto, IP e ticket são obrigatórios; limitação devolve 429 sem enviar email',async()=>{
  const f=fixture(),body=await f.body();
  for(const extra of [{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'},{'CF-Connecting-IP':''}]){
    const response=await handleContact(f.request(body,extra),f.env,f.transport);assert.ok([403,503].includes(response.status));
  }
  for(const token of ['',await issueContactToken(f.env),await issueContactToken(f.env,Date.now()-24*3600000),body.token.slice(0,-1)+'x']){
    assert.equal((await handleContact(f.request({...body,token}),f.env,f.transport)).status,403);
  }
  f.env.FORM_IP_RATE={limit:async()=>({success:false})};
  const limited=await handleContact(f.request(body),f.env,f.transport);assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'60');
  assert.equal(f.calls.length,0);assert.equal(await parseContactToken(null,f.env),null);
});
test('falhas, redirecionamentos e respostas sem id nunca são apresentadas como sucesso',async()=>{
  const f=fixture(),body=await f.body();
  for(const transport of [async()=>Response.json({error:'private-detail'},{status:500}),
    async()=>new Response(null,{status:302,headers:{Location:'https://evil.example'}}),
    async()=>Response.json({}),async()=>{throw Error('secret-internal-detail');}]){
    const response=await handleContact(f.request(body),f.env,transport);assert.ok([502,503].includes(response.status));
    assert.doesNotMatch(await response.text(),/private-detail|secret-internal|accepted/);
  }
  const unavailable=await handleContact(f.request(body),{...f.env,RESEND_API_KEY:''},f.transport);assert.equal(unavailable.status,503);assert.equal(f.calls.length,0);
});
test('proxy ativa somente o formulário conhecido no domínio e protege as respostas da API',async()=>{
  const f=fixture();
  const html='<meta name="time-saver-form-mode" content="disabled"><meta name="time-saver-form-definition" content="direct-email-v1"><form><input></form>';
  const response=await proxyFetch(new Request(ORIGIN+'/'),f.env,async()=>new Response(html,{headers:{'Content-Type':'text/html'}}));
  assert.match(await response.text(),/form-mode" content="backend/);assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'self'/);
  const status=await proxyFetch(new Request(ORIGIN+'/api/form-status',{headers:{'CF-Connecting-IP':'192.0.2.2'}}),f.env,f.transport);
  assert.equal((await status.json()).available,true);assert.equal(status.headers.get('Cache-Control'),'no-store');assert.equal(status.headers.get('X-Frame-Options'),'DENY');
  for(const url of ['http://timesaverautomate.com/api/quote','https://www.timesaverautomate.com/api/quote',ORIGIN+'/api/quote?name=x']){
    assert.equal((await proxyFetch(new Request(url),f.env,f.transport)).status,403);
  }
});
