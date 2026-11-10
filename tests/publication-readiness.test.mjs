import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureContactReadiness} from '../scripts/ensure-contact-api.mjs';

const TICKET='synthetic-readiness-ticket-not-a-secret';
function available({status=200,cache='no-store',data={}}={}){
  const headers=cache===null?{}:{'Cache-Control':cache};
  return Response.json({available:true,version:'direct-email-v1',token:TICKET,...data},{status,headers});
}

test('publicação requer API no domínio fixo, sem cache, e TLS verificado; o ticket não sai do diagnóstico',async()=>{
  const calls=[];
  const result=await ensureContactReadiness({attempts:1,
    fetcher:async(url,options)=>{calls.push({url,options});return available({cache:'private, no-store'});},
    probeTLS:async()=>{calls.push('tls');return {verified:true,diagnostic:'private-data-not-to-publish'};}});
  assert.deepEqual(result,{ready:true,code:'contact_publication_verified'});
  assert.equal(calls[0].url,'https://timesaverautomate.com/api/form-status');
  assert.equal(calls[0].options.headers.Origin,'https://timesaverautomate.com');
  assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[0].options.credentials,'omit');assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[1],'tls');assert.doesNotMatch(JSON.stringify(result),new RegExp(TICKET+'|private-data'));
});

test('API indisponível, versão inesperada ou ticket ausente bloqueiam antes do teste TLS',async()=>{
  let probes=0;
  for(const response of [
    available({status:503}),available({data:{available:false}}),
    available({data:{version:'unknown'}}),available({data:{token:null}}),
    available({data:{token:''}}),available({data:{token:'x'.repeat(601)}}),
    new Response(null,{status:302,headers:{Location:'https://untrusted.example/'}}),
    new Response('private-error',{status:200,headers:{'Cache-Control':'no-store','Content-Type':'text/html'}}),
    new Response(JSON.stringify({available:true,version:'direct-email-v1',token:TICKET}),
      {headers:{'Cache-Control':'no-store','Content-Type':'application/jsonp'}})
  ]){
    const result=await ensureContactReadiness({attempts:1,fetcher:async()=>response,
      probeTLS:async()=>{probes++;return {verified:true};}});
    assert.deepEqual(result,{ready:false,code:'contact_api_unavailable'});
  }
  assert.equal(probes,0);
});

test('caching da API, mesmo com available true, impede publicação',async()=>{
  let probes=0;
  for(const cache of [null,'public, max-age=60','private','no-cache','no-store="response"']){
    const result=await ensureContactReadiness({attempts:1,fetcher:async()=>available({cache}),
      probeTLS:async()=>{probes++;return {verified:true};}});
    assert.deepEqual(result,{ready:false,code:'contact_api_unavailable'});
  }
  assert.equal(probes,0);
});

test('TLS falso, inconclusivo ou com erro bloqueia sem expor mensagens internas',async()=>{
  for(const probeTLS of [async()=>({verified:false}),async()=>({verified:1}),async()=>null,
    async()=>{throw Error('private-tls-stack-and-certificate');}]){
    const result=await ensureContactReadiness({attempts:1,fetcher:async()=>available(),probeTLS});
    assert.deepEqual(result,{ready:false,code:'contact_tls_unverified'});
    assert.doesNotMatch(JSON.stringify(result),/private|certificate|stack/);
  }
});

test('API transitória pode recuperar antes do limite de tentativas; TLS só é testado quando pronta',async()=>{
  const order=[];let requests=0;
  const result=await ensureContactReadiness({attempts:3,
    fetcher:async()=>{order.push('api');requests++;return requests<3?available({data:{available:false}}):available();},
    sleep:async ms=>{order.push('wait');assert.equal(ms,5000);},
    probeTLS:async()=>{order.push('tls');return {verified:true};}});
  assert.equal(result.ready,true);assert.deepEqual(order,['api','wait','api','wait','api','tls']);
});

test('erros de rede esgotam tentativas e não são confundidos com prontidão',async()=>{
  let calls=0,sleeps=0,probes=0;
  const result=await ensureContactReadiness({attempts:2,
    fetcher:async()=>{calls++;throw Error('private-network-details');},
    sleep:async()=>{sleeps++;},probeTLS:async()=>{probes++;return {verified:true};}});
  assert.deepEqual(result,{ready:false,code:'contact_api_unavailable'});
  assert.equal(calls,2);assert.equal(sleeps,1);assert.equal(probes,0);
  assert.doesNotMatch(JSON.stringify(result),/private-network/);
});
