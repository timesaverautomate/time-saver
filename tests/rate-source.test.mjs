import test from 'node:test';
import assert from 'node:assert/strict';
import {contactNetworkSource,handleContact,issueContactToken} from '../src/contact.mjs';
import {keyedHash} from '../src/security.mjs';

const ORIGIN='https://timesaverautomate.com';
function fixture(){
  const counts=new Map(),keys=[],calls=[];
  const env={FORM_ENABLED:'true',RESEND_API_KEY:'re_test_only_not_a_real_key',
    SECURITY_HMAC_KEY:'test-only-'.repeat(9),
    FORM_IP_RATE:{limit:async({key})=>{keys.push(key);const count=(counts.get(key)||0)+1;counts.set(key,count);return {success:count<=5};}},
    FORM_TOKEN_RATE:{limit:async()=>({success:true})},
    FORM_EDGE_RATE:{limit:async()=>({success:true})}};
  const transport=async()=>{calls.push('email');return Response.json({id:'mock-email-id'});};
  const body=async()=>({name:'Teste local',email:'teste@example.com',
    description:'Teste local de limites de rede, sem envio real de emails.',
    token:await issueContactToken(env,Date.now()-2000)});
  const request=(ip,data)=>new Request(ORIGIN+'/api/quote',{method:'POST',headers:{Origin:ORIGIN,
    'CF-Connecting-IP':ip,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(data)});
  return {env,keys,calls,transport,body,request};
}

test('IPv4 canónico mantém a origem e IPv4 mapeado usa a mesma origem',()=>{
  assert.equal(contactNetworkSource('192.0.2.1'),'192.0.2.1');
  assert.equal(contactNetworkSource('0.0.0.0'),'0.0.0.0');
  assert.equal(contactNetworkSource('255.255.255.255'),'255.255.255.255');
  assert.equal(contactNetworkSource('::ffff:192.0.2.1'),'192.0.2.1');
  assert.equal(contactNetworkSource('0:0:0:0:0:FFFF:C000:0201'),'192.0.2.1');
});

test('IPv6 comprimido, completo e com maiúsculas partilha /64; redes distintas mantêm limites independentes',()=>{
  const source=contactNetworkSource('2001:db8:1234:5678::1');
  assert.equal(source,'ipv6/64:2001:0db8:1234:5678');
  assert.equal(contactNetworkSource('2001:0DB8:1234:5678:abcd:0000:0000:0002'),source);
  assert.equal(contactNetworkSource('2001:db8:1234:5678:ffff:ffff:ffff:ffff'),source);
  assert.notEqual(contactNetworkSource('2001:db8:1234:5679::1'),source);
  assert.equal(contactNetworkSource('2001:db8::1'),'ipv6/64:2001:0db8:0000:0000');
});

test('origens inválidas, portas, zone suffixes e IPv4 ambíguo falham de forma fechada',()=>{
  for(const ip of [null,undefined,1,'','192.0.2','192.0.2.256','192.00.2.1','01.2.3.4',
    '192.0.2.1:443','[2001:db8::1]','[2001:db8::1]:443','2001:db8::1%eth0',
    '::ffff:192.0.002.1','2001::db8::1','1:2:3:4:5:6:7:8:9','gggg::1','::1/64',
    '192.0.2.1\n',' 192.0.2.1','https://192.0.2.1']){
    assert.throws(()=>contactNetworkSource(ip),/edge_ip_invalid/);
  }
});

test('rotação de oito endereços no mesmo /64 produz cinco aceites e três 429, sem IP nas chaves',async()=>{
  const f=fixture(),data=await f.body(),statuses=[];
  for(let i=1;i<=8;i++)statuses.push((await handleContact(f.request('2001:db8:1234:5678::'+i,data),f.env,f.transport)).status);
  assert.deepEqual(statuses,[200,200,200,200,200,429,429,429]);
  assert.equal(f.calls.length,5);assert.equal(new Set(f.keys).size,1);
  assert.ok(f.keys.every(key=>/^[a-f0-9]{64}$/.test(key)&&!key.includes('2001:')));
});

test('outro /64 não herda o bloqueio de uma rede IPv6 limitada',async()=>{
  const f=fixture(),data=await f.body();
  for(let i=1;i<=6;i++)await handleContact(f.request('2001:db8:1234:5678::'+i,data),f.env,f.transport);
  const other=await handleContact(f.request('2001:db8:1234:5679::1',data),f.env,f.transport);
  assert.equal(other.status,200);assert.equal(f.calls.length,6);assert.equal(new Set(f.keys).size,2);
});

test('IPv4 mapeado não contorna um limite IPv4 existente e o HMAC IPv4 permanece compatível',async t=>{
  t.mock.method(Date,'now',()=>1794326400000);
  const f=fixture(),data=await f.body();
  for(let i=0;i<5;i++)assert.equal((await handleContact(f.request('192.0.2.1',data),f.env,f.transport)).status,200);
  assert.equal((await handleContact(f.request('::ffff:c000:201',data),f.env,f.transport)).status,429);
  assert.equal(new Set(f.keys).size,1);assert.equal(f.calls.length,5);
  const day=Math.floor(Date.now()/86400000);
  assert.equal(f.keys[0],await keyedHash(f.env.SECURITY_HMAC_KEY,'contact-rate:'+day+':192.0.2.1'));
});

test('IP inválido não chega aos contadores ou ao serviço de email',async()=>{
  const f=fixture(),data=await f.body();
  const response=await handleContact(f.request('[::1]:443',data),f.env,f.transport);
  assert.equal(response.status,503);assert.equal(f.keys.length,0);assert.equal(f.calls.length,0);
  assert.doesNotMatch(await response.text(),/edge_ip_invalid|stack/);
});
