import test from 'node:test';
import assert from 'node:assert/strict';
import {SERVICE_OPTIONS,SERVICE_GROUP_OPTIONS,validateSubmission} from '../src/validation.mjs';
import {handleContact,issueContactToken} from '../src/contact.mjs';
import {quoteRow,QUOTE_HEADERS} from '../src/quote-sheets.mjs';

const INPUT={name:'Teste sintético',email:'synthetic@example.invalid',
  description:'Pedido sintético sem dados de clientes para verificar as áreas selecionadas.'};
const ALL=SERVICE_GROUP_OPTIONS.join(' · ');
const INVALID=[[],['Excel'],['VBA'],['Outro'],['inventado'],[null],[7],[{}],
  [['Excel, macros e VBA']],['Excel, macros e VBA','Excel, macros e VBA'],
  ['Ainda não sei','Dashboards e relatórios'],[' Ainda não sei'],
  ['Excel, macros e VBA\r\nBcc: attacker@example.invalid'],
  [...SERVICE_GROUP_OPTIONS,'Ainda não sei']];

function fixture(){
  const calls=[];let edgeCalls=0;
  const limiter={limit:async()=>({success:true})};
  const env={FORM_ENABLED:'true',RESEND_API_KEY:'re_test_only_not_a_real_key',
    SECURITY_HMAC_KEY:'test-only-'.repeat(9),FORM_IP_RATE:limiter,FORM_TOKEN_RATE:limiter,
    FORM_EDGE_RATE:{limit:async()=>{edgeCalls++;return {success:true};}}};
  const request=body=>new Request('https://timesaverautomate.com/api/quote',{
    method:'POST',headers:{Origin:'https://timesaverautomate.com','Content-Type':'application/json',
      'CF-Connecting-IP':'192.0.2.33','Idempotency-Key':'12345678-1234-4234-8234-123456789abc'},
    body:JSON.stringify(body)});
  const transport=async(url,options)=>{calls.push({url,options});return Response.json({id:'synthetic-provider-id'});};
  return {env,calls,request,transport,edgeCalls:()=>edgeCalls};
}

test('serviços antigos continuam normalizados exatamente como strings, incluindo o valor por omissão',()=>{
  for(const service of SERVICE_OPTIONS){
    const {data,errors}=validateSubmission({...INPUT,service});
    assert.deepEqual(errors,{});assert.equal(data.service,service);
    assert.ok(Object.values(data).every(value=>typeof value==='string'));
  }
  assert.equal(validateSubmission(INPUT).data.service,'Ainda não sei');
  assert.equal(validateSubmission({...INPUT,service:null}).data.service,'Ainda não sei');
  assert.ok(validateSubmission({...INPUT,service:'Excel, macros e VBA '}).errors.service);
});

test('seis áreas ou subconjuntos são normalizados numa string canónica, independentemente da ordem',()=>{
  const forward=validateSubmission({...INPUT,service:SERVICE_GROUP_OPTIONS});
  const reversed=validateSubmission({...INPUT,service:[...SERVICE_GROUP_OPTIONS].reverse()});
  assert.deepEqual(forward.errors,{});assert.deepEqual(reversed,forward);
  assert.equal(forward.data.service,ALL);assert.equal(ALL.length,144);
  assert.equal(typeof forward.data.service,'string');
  const subset=validateSubmission({...INPUT,service:['Aplicação à medida','Dashboards e relatórios']});
  assert.deepEqual(subset.errors,{});
  assert.equal(subset.data.service,'Dashboards e relatórios · Aplicação à medida');
});

test('uma área e Ainda não sei isolado conservam a representação de um pedido antigo',()=>{
  for(const service of [...SERVICE_GROUP_OPTIONS,'Ainda não sei']){
    assert.deepEqual(validateSubmission({...INPUT,service:[service]}),validateSubmission({...INPUT,service}));
  }
});

test('listas vazias, repetidas, desconhecidas, mal tipadas ou combinadas com Ainda não sei são recusadas',()=>{
  for(const service of INVALID){
    const {data,errors}=validateSubmission({...INPUT,service});
    assert.ok(errors.service,JSON.stringify(service));assert.equal(data.service,undefined);
  }
  // Mesmo entradas diretas esparsas não são confundidas com escolhas válidas.
  assert.ok(validateSubmission({...INPUT,service:Array(1)}).errors.service);
});

test('email contém todas as áreas e ordem invertida conserva corpo e chave idempotentes',async()=>{
  const f=fixture(),token=await issueContactToken(f.env,Date.now()-2000);
  const first=await handleContact(f.request({...INPUT,service:SERVICE_GROUP_OPTIONS,token}),f.env,f.transport);
  const second=await handleContact(f.request({...INPUT,service:[...SERVICE_GROUP_OPTIONS].reverse(),token}),f.env,f.transport);
  assert.equal(first.status,200);assert.equal(second.status,200);
  assert.deepEqual(await first.json(),await second.json());
  const sent=JSON.parse(f.calls[0].options.body);
  assert.ok(sent.text.includes('Tipo de ajuda: '+ALL+'\n'));
  assert.deepEqual(sent.to,['timesaverautomate@gmail.com']);
  assert.equal(sent.from,'Time Saver <pedidos@timesaverautomate.com>');
  assert.equal(sent.reply_to,INPUT.email);assert.equal(sent.html,undefined);
  assert.equal(f.calls[0].options.body,f.calls[1].options.body);
  assert.equal(f.calls[0].options.headers['Idempotency-Key'],f.calls[1].options.headers['Idempotency-Key']);
});

test('listas inválidas recebem 422 antes de contactar o fornecedor ou consumir o limite global',async()=>{
  const f=fixture(),token=await issueContactToken(f.env,Date.now()-2000);
  for(const service of INVALID){
    const response=await handleContact(f.request({...INPUT,service,token}),f.env,f.transport);
    assert.equal(response.status,422,JSON.stringify(service));
    assert.ok((await response.json()).errors.service);
  }
  assert.equal(f.calls.length,0);assert.equal(f.edgeCalls(),0);
});

test('a linha CRM conserva as seis áreas sem cortar nem alterar colunas ou tipos',()=>{
  const {data,errors}=validateSubmission({...INPUT,service:SERVICE_GROUP_OPTIONS});
  assert.deepEqual(errors,{});
  const row=quoteRow(data,'TS-0123456789ABCDEF0123',1762790400000);
  assert.equal(row.length,QUOTE_HEADERS.length);assert.equal(row[5],ALL);
  assert.equal(row[5].length,144);assert.ok(row.every(value=>typeof value==='string'));
  const old=quoteRow({...data,service:'Excel'},'TS-0123456789ABCDEF0123',1762790400000);
  assert.equal(old[5],'Excel');
  assert.deepEqual(row.filter((_,index)=>index!==5),old.filter((_,index)=>index!==5));
});
