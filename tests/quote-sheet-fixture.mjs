import assert from 'node:assert/strict';
import {QUOTE_HEADERS,QUOTE_STATUS_FORMULA} from '../src/quote-sheets.mjs';

export function quoteSheetFixture({onBatch,metadataId,onBeforeStatusUpdate,locale='pt_PT',
  properties=[{properties:{sheetId:37,title:'Pedidos do Site'}}]}={}){
  const values=[QUOTE_HEADERS.slice()],markers=new Map(),linkedRows=new Map(),formulaRows=new WeakSet();
  const formats={1:{foreground:'white'},2:{foreground:'black',wrap:true}};
  const calls={batches:[],committed:0,metadataGets:0,properties:0,update:0,statusBodies:[]};
  Object.defineProperty(calls,'append',{get:()=>calls.committed,enumerable:true});
  function insertAt(index,row){
    values.splice(index,0,row);
    for(const marker of markers.values()){
      const range=marker.location?.dimensionRange;
      if(range?.sheetId===37&&range.dimension==='ROWS'&&range.startIndex>=index){range.startIndex++;range.endIndex++;}
    }
  }
  function reorder(compare){
    const head=values[0],body=values.slice(1).sort(compare);values.splice(0,values.length,head,...body);
    for(const [id,row]of linkedRows){const range=markers.get(id).location.dimensionRange;range.startIndex=values.indexOf(row);range.endIndex=range.startIndex+1;}
  }
  function commit(requests){
    assert.equal(requests.length,3);
    const insert=requests[0].insertDimension,update=requests[1].updateCells;
    const marker=requests[2].createDeveloperMetadata.developerMetadata;
    if(markers.has(marker.metadataId))return Response.json({error:{code:400}},{status:400});
    assert.deepEqual(insert,{range:{sheetId:37,dimension:'ROWS',startIndex:1,endIndex:2},inheritFromBefore:false});
    assert.deepEqual(update.start,{sheetId:37,rowIndex:1,columnIndex:0});assert.equal(update.fields,'userEnteredValue');
    assert.equal(marker.metadataKey,'tq');assert.equal(marker.metadataValue,undefined);assert.equal(marker.visibility,'DOCUMENT');
    assert.deepEqual(marker.location,{dimensionRange:{sheetId:37,dimension:'ROWS',startIndex:1,endIndex:2}});
    assert.equal(update.rows.length,1);assert.equal(update.rows[0].values.length,18);
    const row=update.rows[0].values.map((cell,index)=>{
      assert.deepEqual(Object.keys(cell),['userEnteredValue']);
      if(index===14){assert.deepEqual(cell.userEnteredValue,{formulaValue:QUOTE_STATUS_FORMULA});return 'Pendente envio';}
      assert.deepEqual(Object.keys(cell.userEnteredValue),['stringValue']);assert.equal(typeof cell.userEnteredValue.stringValue,'string');return cell.userEnteredValue.stringValue;
    });
    // Validate the whole transaction before mutating the model.
    insertAt(1,row);markers.set(marker.metadataId,structuredClone(marker));linkedRows.set(marker.metadataId,row);formulaRows.add(row);calls.committed++;
    return Response.json({replies:[{},{},{createDeveloperMetadata:{developerMetadata:marker}}]});
  }
  async function fetcher(raw,init={}){
    const url=new URL(raw),body=init.body?JSON.parse(init.body):null;
    if(url.pathname.endsWith('/values:batchGetByDataFilter')){
      return Response.json({valueRanges:body.dataFilters.flatMap(filter=>{
        const lookup=filter.developerMetadataLookup,marker=markers.get(lookup.metadataId),range=marker?.location?.dimensionRange;
        if(!range||marker.metadataKey!==lookup.metadataKey||lookup.locationType!=='ROW'||marker.visibility!==lookup.visibility)return [];
        const row=values[range.startIndex];if(!row)return [];
        return [{dataFilters:[filter],valueRange:{range:"'Pedidos do Site'!A"+(range.startIndex+1)+':R'+(range.startIndex+1),majorDimension:'ROWS',values:[structuredClone(row)]}}];
      })});
    }
    if(url.pathname.endsWith('/values:batchUpdateByDataFilter')){
      if(onBeforeStatusUpdate)await onBeforeStatusUpdate({values,markers,insertAt,reorder});
      calls.update++;calls.statusBodies.push(structuredClone(body));assert.equal(body.valueInputOption,'RAW');assert.equal(body.data.length,1);
      const request=body.data[0],marker=markers.get(request.dataFilter.developerMetadataLookup.metadataId),range=marker?.location?.dimensionRange;
      if(!range)return Response.json({totalUpdatedRows:0,totalUpdatedCells:0});
      const row=values[range.startIndex],updates=request.values[0];assert.equal(updates.length,18);
      for(let i=0;i<18;i++)if(![16,17].includes(i))assert.equal(updates[i],null);
      if(!['Pendente envio','Novo'].includes(row[14]))formulaRows.delete(row);
      row[16]=updates[16];row[17]=updates[17];if(formulaRows.has(row))row[14]=row[17]?'Novo':'Pendente envio';
      return Response.json({totalUpdatedRows:1,totalUpdatedCells:2});
    }
    if(url.pathname.endsWith(':batchUpdate')){
      assert.equal(init.method,'POST');const requests=body.requests;calls.batches.push(structuredClone(requests));
      return onBatch?onBatch({requests,commit,calls,values,markers}):commit(requests);
    }
    if(url.pathname.includes('/developerMetadata/')){
      calls.metadataGets++;const id=Number(url.pathname.split('/').at(-1));
      return markers.has(id)?Response.json(markers.get(id)):Response.json({error:{code:404}},{status:404});
    }
    if(url.searchParams.has('fields')){
      calls.properties++;assert.equal(url.searchParams.get('fields'),'properties(locale),sheets(properties(sheetId,title))');return Response.json({properties:{locale},sheets:properties});
    }
    assert.equal(decodeURIComponent(url.pathname).split('/values/')[1],"'Pedidos do Site'!A1:R10000");return Response.json({values:structuredClone(values)});
  }
  return {values,markers,calls,formats,commit,insertAt,reorder,fetcher,
    stats:()=>({appends:calls.committed,updates:calls.update}),
    options:{fetcher,authorize:async()=> 'synthetic-access',...(metadataId?{metadataId}:{})}};
}
