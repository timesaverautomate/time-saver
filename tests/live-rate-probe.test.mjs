import test from 'node:test';
import assert from 'node:assert/strict';
import {probeLiveRateLimit} from '../scripts/probe-live-rate-limit.mjs';

const ORIGIN='https://timesaverautomate.com';
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY_ID:'1452563434',GITHUB_REPOSITORY:'timesaverautomate/time-saver',
  GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'1234',RESEND_API_KEY:'re_test_only_not_a_real_key'};
function fixture({limit=5,neverBlock=false,change,resetBlocked=false}={}){
  let now=1794000000000,windowStart=now,count=0,postNumber=0;
  const calls=[],sleeps=[],tokens=[],socket={},changedSocket={};
  const source='a'.repeat(32),otherSource='b'.repeat(32),colo='AMS';
  const transport=async request=>{
    calls.push(request);
    assert.ok([ORIGIN+'/api/quote',ORIGIN+'/robots.txt'].includes(request.url));
    assert.ok(request.signal instanceof AbortSignal);
    if(request.method==='GET')return {status:200,headers:new Headers({'X-Time-Saver-Edge':'1'}),body:'User-agent: *',socket};
    postNumber++;
    assert.equal(request.url,ORIGIN+'/api/quote');assert.equal(request.body,'{}');assert.equal(request.headers.Origin,ORIGIN);
    assert.equal(request.headers['Content-Type'],'application/json');assert.equal(request.headers['Content-Length'],'2');
    const token=request.headers['X-Time-Saver-Rate-Probe'];tokens.push(token.split('.'));
    if(now-windowStart>=60000&&!resetBlocked){windowStart=now;count=0;}
    count++;
    const status=!neverBlock&&count>limit?429:422;
    const headers=new Headers({'X-Time-Saver-Edge':'1','Cache-Control':'no-store',
      'X-Time-Saver-Rate-Source':source,'X-Time-Saver-Rate-Colo':colo});
    if(status===429)headers.set('Retry-After','60');
    const response={status,headers,socket,body:JSON.stringify(status===422
      ?{errors:{name:'Obrigatório',email:'Inválido',description:'Obrigatório'}}:{message:'Aguarde um minuto.'})};
    if(change)change({request,response,postNumber,source,otherSource,changedSocket});
    return response;
  };
  return {calls,sleeps,tokens,source,colo,clock:()=>now,
    sleep:async ms=>{sleeps.push(ms);now+=ms;},transport,
    advance:ms=>{now+=ms;}};
}

test('prova 429 persistente e reset após 65s no mesmo socket/origem/colo, com pedidos deliberadamente inválidos',async()=>{
  const f=fixture(),result=await probeLiveRateLimit({env,...f});
  assert.equal(result.verified,true);assert.equal(result.rateLimited,true);assert.equal(result.resetVerified,true);
  assert.equal(result.stableSources,true);assert.equal(result.stableColos,true);assert.equal(result.stableSocket,true);
  assert.equal(result.withinConfiguredLimit,true);assert.equal(result.overshoot,false);
  assert.deepEqual(result.statuses,[422,422,422,422,422,429,429,422]);assert.deepEqual(result.retryAfterSeconds,[60,60]);
  assert.equal(f.calls.filter(call=>call.method==='POST').length,8);assert.equal(f.calls.filter(call=>call.method==='GET').length,4);
  assert.equal(f.sleeps.filter(ms=>ms===15000).length,4);assert.equal(f.sleeps.at(-1),5000);
  assert.equal(new Set(f.tokens.map(parts=>parts[1])).size,1,'A sessão mantém-se durante a renovação de assinaturas.');
  assert.notEqual(f.tokens[0][0],f.tokens.at(-1)[0],'O timestamp é renovado após o cooldown.');
  const json=JSON.stringify(result);assert.ok(!json.includes(f.source)&&!json.includes(f.colo));
  assert.ok(!json.includes(env.RESEND_API_KEY));assert.ok(f.tokens.every(parts=>!json.includes(parts.join('.'))));
});

test('overshoot nativo é registado como observação sem inventar um limite estrito',async()=>{
  const f=fixture({limit:8}),result=await probeLiveRateLimit({env,...f});
  assert.equal(result.verified,true);assert.equal(result.withinConfiguredLimit,false);assert.equal(result.overshoot,true);
  assert.equal(result.statuses.indexOf(429),8);assert.ok(f.calls.filter(call=>call.method==='POST').length<=15);
});

test('ausência de 429 dentro do orçamento fica inconclusiva e não faz chamadas extra',async()=>{
  const f=fixture({neverBlock:true}),result=await probeLiveRateLimit({env,...f});
  assert.equal(result.verified,false);assert.equal(result.code,'rate_probe_inconclusive_no_block');
  assert.equal(result.statuses.length,12);assert.equal(result.resetVerified,false);
  assert.equal(f.calls.filter(call=>call.method==='GET').length,0);
});

test('headers diagnósticos ausentes ou resposta sem marca do Worker nunca aprovam o teste',async()=>{
  for(const header of ['X-Time-Saver-Rate-Source','X-Time-Saver-Rate-Colo','X-Time-Saver-Edge','Cache-Control']){
    const f=fixture({change:({response})=>response.headers.delete(header)});
    const result=await probeLiveRateLimit({env,...f});
    assert.equal(result.verified,false);assert.equal(f.calls.length,1);assert.equal(result.resetVerified,false);
  }
});

test('mudança da origem, colo ou socket fica inconclusiva sem revelar os seus valores',async()=>{
  const changes=[
    ({response,otherSource})=>response.headers.set('X-Time-Saver-Rate-Source',otherSource),
    ({response})=>response.headers.set('X-Time-Saver-Rate-Colo','LHR'),
    ({response,changedSocket})=>{response.socket=changedSocket;}
  ];
  for(const change of changes){
    const f=fixture({change:args=>{if(args.postNumber===2)change(args);}}),result=await probeLiveRateLimit({env,...f});
    assert.equal(result.verified,false);assert.match(result.code,/rate_probe_inconclusive_/);
    assert.ok(!JSON.stringify(result).includes(f.source));assert.equal(f.calls.length,2);
  }
});

test('bloqueio não persistente ou reset não observado não são sucesso',async()=>{
  const reset=fixture({resetBlocked:true}),notReset=await probeLiveRateLimit({env,...reset});
  assert.equal(notReset.verified,false);assert.equal(notReset.code,'rate_probe_reset_not_verified');
  const unstable=fixture({change:({response,postNumber})=>{
    if(postNumber===7){response.status=422;response.body=JSON.stringify({errors:{name:'Obrigatório',email:'Inválido',description:'Obrigatório'}});}
  }});
  const notPersistent=await probeLiveRateLimit({env,...unstable});
  assert.equal(notPersistent.verified,false);assert.equal(notPersistent.code,'rate_probe_block_not_persistent');
});

test('contexto, branch, destino e proxy inválidos impedem toda a rede',async()=>{
  for(const changed of [{GITHUB_ACTIONS:''},{GITHUB_REPOSITORY_ID:'other'},{GITHUB_REPOSITORY:'attacker/repo'},
    {GITHUB_REF:'refs/heads/other'},{HTTPS_PROXY:'http://proxy.invalid:8080'}]){
    let called=0;
    const result=await probeLiveRateLimit({env:{...env,...changed},transport:async()=>{called++;throw Error('unexpected');}});
    assert.equal(result.verified,false);assert.equal(called,0);
  }
});

test('deadline absoluto e erros internos terminam com códigos públicos sem detalhes',async()=>{
  const slow=fixture();
  const original=slow.transport;slow.transport=async request=>{slow.advance(180001);return original(request);};
  const timedOut=await probeLiveRateLimit({env,...slow});assert.equal(timedOut.code,'rate_probe_timeout');assert.equal(timedOut.verified,false);
  const failed=await probeLiveRateLimit({env,transport:async()=>{throw Error('private-transport-details');}});
  assert.equal(failed.verified,false);assert.doesNotMatch(JSON.stringify(failed),/private-transport/);
});
