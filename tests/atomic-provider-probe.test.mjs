import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyQuoteAtomicProvider} from '../scripts/verify-quote-atomic-provider.mjs';
import {QUOTE_HEADERS,QUOTE_STATUS_FORMULA} from '../src/quote-sheets.mjs';
const ENV={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY_ID:'1452563434',GITHUB_REPOSITORY:'timesaverautomate/time-saver',GITHUB_REF:'refs/heads/main'};
function fixture({bothAccepted=false,badFormat=false,cleanupFails=false,setupFails=false,
  badSortAnchor=false,badNullSkip=false,badManualStatus=false,formulaError=false,trailingEmpty=false,locale='pt_PT'}={}){
  const calls=[],markers=new Map(),rows=new Map(),manualStates=new Map();let id=40,title,order=[],lastMetadataOrder=[],alternateUsed=false;
  const values=()=>[QUOTE_HEADERS,...order.map(key=>{const row=[...rows.get(key)];row[14]=manualStates.get(key)||(formulaError&&!alternateUsed?'#ERROR!':row[17]?'Novo':'Pendente envio');if(!trailingEmpty)while(row.at(-1)==='')row.pop();return row;})];
  return {calls,options:{env:ENV,randomID:()=>++id,uuid:()=> 'a501ca79-5547-4fb3-bb98-81d64a84e764',
    authorize:async()=> 'synthetic-only',fetcher:async(url,init)=>{
      assert.equal(new URL(url).hostname,'sheets.googleapis.com');assert.equal(init.redirect,'error');assert.ok(init.signal);
      const body=init.body?JSON.parse(init.body):null;calls.push({url,body});
      if(url.endsWith('?fields=properties(locale)'))return Response.json({properties:{locale}});
      if(body?.requests?.[0]?.updateCells){alternateUsed=true;return Response.json({replies:[{}]});}
      if(body?.requests?.[0]?.addSheet){
        if(setupFails)return Response.json({error:'synthetic'},{status:500});
        const properties=body.requests[0].addSheet.properties;title=properties.title;
        assert.equal(properties.hidden,true);assert.equal(properties.sheetId,41);
        return Response.json({replies:[{addSheet:{properties}}]});
      }
      if(body?.requests?.[0]?.deleteSheet){assert.deepEqual(body.requests,[{deleteSheet:{sheetId:41}}]);return Response.json({},{status:cleanupFails?500:200});}
      if(body?.requests?.[0]?.insertDimension){
        const marker=body.requests[2].createDeveloperMetadata.developerMetadata;
        assert.equal(marker.metadataKey,'tq');assert.equal(marker.metadataValue,undefined);
        assert.deepEqual(marker.location,{dimensionRange:{sheetId:41,dimension:'ROWS',startIndex:1,endIndex:2}});
        if(markers.has(marker.metadataId))return Response.json({},{status:bothAccepted?200:400});
        const cells=body.requests[1].updateCells.rows[0].values;
        assert.equal(cells[14].userEnteredValue.formulaValue,QUOTE_STATUS_FORMULA);
        const row=cells.map((cell,i)=>i===14?'Pendente envio':cell.userEnteredValue.stringValue);
        const key=row[0];rows.set(key,row);order.unshift(key);lastMetadataOrder=[...order];markers.set(marker.metadataId,key);
        return Response.json({replies:[{},{},{createDeveloperMetadata:{developerMetadata:marker}}]});
      }
      if(body?.requests?.[0]?.sortRange){
        const sort=body.requests[0].sortRange;
        assert.equal(sort.range.sheetId,41);assert.equal(sort.range.startRowIndex,1);assert.equal(sort.range.endRowIndex,3);
        order.sort();if(sort.sortSpecs[0].sortOrder==='DESCENDING')order.reverse();if(!badSortAnchor)lastMetadataOrder=[...order];
        return Response.json({replies:[{}]});
      }
      if(url.includes('/developerMetadata/')){
        const metadataId=Number(url.split('/').at(-1)),key=markers.get(metadataId),index=lastMetadataOrder.indexOf(key)+1;
        return Response.json({metadataId,metadataKey:'tq',visibility:'DOCUMENT',location:{dimensionRange:{sheetId:41,dimension:'ROWS',startIndex:index,endIndex:index+1}}});
      }
      if(url.endsWith('/values:batchGetByDataFilter')){
        const filter=body.dataFilters[0],key=markers.get(filter.developerMetadataLookup.metadataId),index=order.indexOf(key)+1;
        return Response.json({valueRanges:[{dataFilters:[filter],valueRange:{range:"'"+title+"'!A"+(index+1)+':R'+(index+1),values:[values()[index]]}}]});
      }
      if(url.endsWith('/values:batchUpdateByDataFilter')){
        const update=body.data[0],key=markers.get(update.dataFilter.developerMetadataLookup.metadataId),row=rows.get(key);
        assert.equal(body.valueInputOption,'RAW');assert.equal(update.values.length,1);assert.equal(update.values[0].length,18);
        update.values[0].forEach((value,i)=>{if([16,17].includes(i))row[i]=value;else assert.equal(value,null)});
        if(badManualStatus)manualStates.delete(key);
        return Response.json({totalUpdatedRows:1,totalUpdatedCells:badNullSkip?18:2});
      }
      if(url.endsWith('/values:batchUpdate')){
        assert.equal(body.data[0].range,"'"+title+"'!O2");manualStates.set(order[0],body.data[0].values[0][0]);return Response.json({totalUpdatedCells:1});
      }
      if(url.includes('/values/')){assert.ok(decodeURIComponent(url).includes(title));return Response.json({values:decodeURIComponent(url).endsWith('!A2:R2')?[values()[1]]:values()});}
      if(decodeURIComponent(url).includes('!O2')&&url.includes('effectiveValue'))return Response.json({sheets:[{data:[{rowData:[{values:[{userEnteredValue:{formulaValue:QUOTE_STATUS_FORMULA},effectiveValue:{errorValue:{type:'ERROR',message:'private_api_detail_never_log'}}}]}]}]}]});
      const format={textFormat:{foregroundColor:badFormat?{red:1,green:1,blue:1}:{}},backgroundColor:{red:1,green:1,blue:1}};
      const formatted=Array.from({length:18},()=>({}));formatted[0]={effectiveFormat:format};formatted[1]={userEnteredValue:{stringValue:'=1+1'}};formatted[14]={userEnteredValue:{formulaValue:QUOTE_STATUS_FORMULA}};
      return Response.json({sheets:[{data:[{rowData:[{values:formatted}]}]}]});
    }}};
}
test('prova do fornecedor confirma inserção, ordenação, filtro e estado manual numa folha temporária própria',async()=>{
  const f=fixture(),result=await verifyQuoteAtomicProvider(f.options);
  assert.equal(result.verified,true);assert.equal(result.uniqueRows,1);assert.equal(result.temporarySheetRemoved,true);
  for(const field of ['literalTextVerified','preservedFormatsVerified','rowAnchorMovesVerified','sortAnchorMovesVerified','metadataDataFilterVerified','nullSkipVerified','manualStatusPreserved'])assert.equal(result[field],true,field);
  assert.deepEqual(result.statuses,[200,400]);assert.equal(f.calls.filter(call=>call.body?.requests?.[0]?.deleteSheet).length,1);
});
test('atomicidade, formato, ordenação, null-skip ou estado manual não confirmados bloqueiam a prova',async()=>{
  for(const [setup,code] of [[{bothAccepted:true},'atomic_probe_uniqueness_failed'],[{badFormat:true},'atomic_probe_format_changed'],
    [{badSortAnchor:true},'atomic_probe_sort_anchor_failed'],[{badNullSkip:true},'atomic_probe_null_skip_failed'],[{badManualStatus:true},'atomic_probe_manual_status_failed']]){
    const f=fixture(setup),result=await verifyQuoteAtomicProvider(f.options);
    assert.equal(result.verified,false);assert.equal(result.code,code);assert.equal(result.temporarySheetRemoved,true);
  }
});
test('contexto, criação e eliminação não confirmados falham sem apagar folhas existentes',async()=>{
  const absent=fixture();assert.equal((await verifyQuoteAtomicProvider({...absent.options,env:{}})).verified,false);assert.equal(absent.calls.length,0);
  const setup=fixture({setupFails:true}),badSetup=await verifyQuoteAtomicProvider(setup.options);
  assert.equal(badSetup.code,'atomic_probe_setup_failed');assert.equal(setup.calls.some(call=>call.body?.requests?.[0]?.deleteSheet),false);
  const cleanup=fixture({cleanupFails:true}),badCleanup=await verifyQuoteAtomicProvider(cleanup.options);
  assert.equal(badCleanup.verified,false);assert.equal(badCleanup.code,'atomic_probe_cleanup_pending');
});


test('diagnóstico de fórmula e locale é classificado, sintético e não revela valores ou mensagens da API',async()=>{
 const f=fixture({formulaError:true}),result=await verifyQuoteAtomicProvider(f.options);
 assert.equal(result.verified,false);assert.equal(result.code,'atomic_probe_values_failed');assert.equal(result.temporarySheetRemoved,true);
 assert.equal(result.diagnostic.locale,'pt_PT');assert.equal(result.diagnostic.stage,'initial_values');
 assert.equal(result.diagnostic.formulaStatus,'#ERROR!');assert.equal(result.diagnostic.originalFormulaErrorType,'ERROR');
 assert.equal(result.diagnostic.originalFormulaMatches,true);assert.equal(result.diagnostic.alternativeFormulaAccepted,true);
 assert.equal(result.diagnostic.alternativeFormulaStatus,'Pendente envio');assert.deepEqual(result.diagnostic.contentMismatchColumns,[14]);
 assert.doesNotMatch(JSON.stringify(result),/private_api_detail|texto fictício|synthetic-only/);
});

test('diagnóstico distingue a inclusão legítima da última célula vazia de erro na fórmula',async()=>{
 const f=fixture({trailingEmpty:true}),result=await verifyQuoteAtomicProvider(f.options);
 assert.equal(result.verified,false);assert.equal(result.code,'atomic_probe_values_failed');assert.equal(result.temporarySheetRemoved,true);
 assert.equal(result.diagnostic.formulaStatus,'Pendente envio');assert.equal(result.diagnostic.trailingEmptyCellIncluded,true);
 assert.deepEqual(result.diagnostic.rowLengths,[18,18]);assert.deepEqual(result.diagnostic.contentMismatchColumns,[]);
 assert.equal(result.diagnostic.alternativeFormulaStatus,'not_tested');
});


test('locale não comprovado bloqueia a prova antes de criar qualquer folha temporária',async()=>{
 for(const locale of ['en_US','pt_BR',undefined,'']){
  const f=fixture({locale:locale===undefined?null:locale}),result=await verifyQuoteAtomicProvider(f.options);
  assert.equal(result.verified,false);assert.equal(result.code,'atomic_probe_locale_mismatch');
  assert.equal(result.temporarySheetRemoved,false);
  assert.equal(f.calls.some(call=>call.body?.requests?.[0]?.addSheet),false);
 }
});
