import test from 'node:test';
import assert from 'node:assert/strict';
import {probeLiveQuoteConcurrency} from '../scripts/probe-live-quote-concurrency.mjs';
import {QUOTE_HEADERS} from '../src/quote-sheets.mjs';
const ENV={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY_ID:'1452563434',GITHUB_REPOSITORY:'timesaverautomate/time-saver',GITHUB_REF:'refs/heads/main'};
const REF='TS-ABCDEF0123456789ABCD';
function fixture({busy=false,duplicateRows=false,wrongReference=false}={}){
  const requests=[],payloads=[],keys=[],sleeps=[];let posts=0;
  const options={env:ENV,uuid:()=> 'a501ca79-5547-4fb3-bb98-81d64a84e764',authorize:async()=> 'synthetic-only',
    sleep:async ms=>sleeps.push(ms),fetcher:async(url,init)=>{
      requests.push({url,method:init.method});assert.equal(init.redirect,'error');
      if(url.endsWith('/api/form-status'))return Response.json({available:true,token:'synthetic-token'});
      if(url.endsWith('/api/quote')){
        posts++;payloads.push(init.body);keys.push(init.headers['Idempotency-Key']);
        assert.equal(init.headers.Origin,'https://timesaverautomate.com');
        const parsed=JSON.parse(init.body);assert.equal(parsed.email,'timesaverautomate@gmail.com');
        assert.equal(parsed.company,'TESTE INTERNO — concorrência e idempotência');
        if(busy&&posts===2)return Response.json({message:'pending'},{status:409});
        return Response.json({accepted:true,reference:wrongReference&&posts===2?'TS-00000000000000000000':REF});
      }
      assert.equal(new URL(url).hostname,'sheets.googleapis.com');
      const row=Array(18).fill('');row[0]=REF;row[4]='TESTE INTERNO — concorrência e idempotência';row[14]='Novo';row[17]='synthetic-provider-id';
      return Response.json({values:[QUOTE_HEADERS,row,...(duplicateRows?[row]:[])]});
    }};
  return {options,requests,payloads,keys,sleeps};
}
test('prova real é bloqueada fora do contexto main autorizado sem contactar fornecedores',async()=>{
  const f=fixture();const result=await probeLiveQuoteConcurrency({...f.options,env:{...ENV,GITHUB_REF:'refs/heads/other'}});
  assert.deepEqual(result,{verified:false,code:'quote_probe_context_invalid'});assert.equal(f.requests.length,0);
});
test('dois pedidos simultâneos e repetição conservam o corpo e chave, verificando exatamente uma linha',async()=>{
  const f=fixture(),result=await probeLiveQuoteConcurrency(f.options);
  assert.equal(result.verified,true);assert.equal(result.crmRows,1);assert.equal(result.totalPosts,3);
  assert.deepEqual(result.submissionStatuses,[200,200]);assert.equal(new Set(f.keys).size,1);assert.equal(new Set(f.payloads).size,1);
  assert.equal(f.sleeps[0],1800);assert.equal(result.inboxDelivery,'verify_separately');
  assert.ok(f.requests.every(request=>['timesaverautomate.com','sheets.googleapis.com'].includes(new URL(request.url).hostname)));
});
test('409 transitório repete a mesma tentativa e respeita orçamento de quatro POSTs',async()=>{
  const f=fixture({busy:true}),result=await probeLiveQuoteConcurrency(f.options);
  assert.equal(result.verified,true);assert.equal(result.totalPosts,4);assert.deepEqual(result.submissionStatuses,[200,409]);
  assert.equal(new Set(f.keys).size,1);assert.equal(new Set(f.payloads).size,1);assert.ok(f.sleeps.includes(3200));
});
test('linhas duplicadas, referências divergentes e falhas de rede não são reportadas como sucesso',async()=>{
  for(const [setup,code] of [[{duplicateRows:true},'quote_probe_crm_duplicate_or_missing'],[{wrongReference:true},'quote_probe_reference_mismatch']]){
    const f=fixture(setup),result=await probeLiveQuoteConcurrency(f.options);assert.deepEqual(result,{verified:false,code});
  }
  const f=fixture(),result=await probeLiveQuoteConcurrency({...f.options,fetcher:()=>{throw Error('private-value-not-to-log');}});
  assert.deepEqual(result,{verified:false,code:'quote_probe_unavailable'});
});
