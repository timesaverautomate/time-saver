import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyQuoteAtomicProvider} from '../scripts/verify-quote-atomic-provider.mjs';
import {QUOTE_HEADERS} from '../src/quote-sheets.mjs';
const ENV={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY_ID:'1452563434',GITHUB_REPOSITORY:'timesaverautomate/time-saver',GITHUB_REF:'refs/heads/main'};
function fixture({bothAccepted=false,badFormat=false,cleanupFails=false,setupFails=false}={}){
  const calls=[];let id=40,batches=0,title;
  return {calls,options:{env:ENV,randomID:()=>++id,uuid:()=> 'a501ca79-5547-4fb3-bb98-81d64a84e764',
    authorize:async()=> 'synthetic-only',fetcher:async(url,init)=>{
      assert.equal(new URL(url).hostname,'sheets.googleapis.com');assert.equal(init.redirect,'error');
      const body=init.body?JSON.parse(init.body):null;calls.push({url,body});
      if(body?.requests[0].addSheet){
        if(setupFails)return Response.json({error:'synthetic'},{status:500});
        const properties=body.requests[0].addSheet.properties;title=properties.title;
        assert.equal(properties.hidden,true);assert.equal(properties.sheetId,41);
        return Response.json({replies:[{addSheet:{properties}}]});
      }
      if(body?.requests[0].deleteSheet){
        assert.deepEqual(body.requests,[{deleteSheet:{sheetId:41}}]);
        return Response.json({}, {status:cleanupFails?500:200});
      }
      if(body?.requests[0].createDeveloperMetadata){
        batches++;const marker=body.requests[0].createDeveloperMetadata.developerMetadata;
        assert.equal(marker.metadataId,42);assert.deepEqual(marker.location,{sheetId:41});
        assert.equal(body.requests[1].appendCells.fields,'userEnteredValue');
        return Response.json({}, {status:bothAccepted||batches===1?200:400});
      }
      if(url.includes('/values/')){
        assert.ok(decodeURIComponent(url).includes(title));
        const cells=Array(18).fill('texto fictício');cells[0]='TS-TESTE-ATOMICIDADE';cells[1]='=1+1';
        return Response.json({values:[QUOTE_HEADERS,cells]});
      }
      const format={textFormat:{foregroundColor:badFormat?{red:1,green:1,blue:1}:{}},backgroundColor:{red:1,green:1,blue:1}};
      return Response.json({sheets:[{data:[{rowData:[{values:[{effectiveFormat:format},{userEnteredValue:{stringValue:'=1+1'}}]}]}]}]});
    }}};
}
test('prova do fornecedor só toca numa folha temporária própria e remove-a após transação e formato válidos',async()=>{
  const f=fixture(),result=await verifyQuoteAtomicProvider(f.options);
  assert.equal(result.verified,true);assert.equal(result.uniqueRows,1);assert.equal(result.temporarySheetRemoved,true);
  assert.equal(result.literalTextVerified,true);assert.equal(result.preservedFormatsVerified,true);
  assert.deepEqual(result.statuses,[200,400]);assert.equal(f.calls.filter(call=>call.body?.requests[0].deleteSheet).length,1);
});
test('falhas de atomicidade/formatação limpam a folha temporária e nunca são sucesso',async()=>{
  for(const [setup,code] of [[{bothAccepted:true},'atomic_probe_uniqueness_failed'],[{badFormat:true},'atomic_probe_format_changed']]){
    const f=fixture(setup),result=await verifyQuoteAtomicProvider(f.options);
    assert.equal(result.verified,false);assert.equal(result.code,code);assert.equal(result.temporarySheetRemoved,true);
  }
});
test('contexto, criação e eliminação não confirmados falham sem apagar folhas existentes',async()=>{
  const absent=fixture();assert.equal((await verifyQuoteAtomicProvider({...absent.options,env:{}})).verified,false);assert.equal(absent.calls.length,0);
  const setup=fixture({setupFails:true}),badSetup=await verifyQuoteAtomicProvider(setup.options);
  assert.equal(badSetup.code,'atomic_probe_setup_failed');assert.equal(setup.calls.some(call=>call.body?.requests[0].deleteSheet),false);
  const cleanup=fixture({cleanupFails:true}),badCleanup=await verifyQuoteAtomicProvider(cleanup.options);
  assert.equal(badCleanup.verified,false);assert.equal(badCleanup.code,'atomic_probe_cleanup_pending');
});
