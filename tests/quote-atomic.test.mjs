import test from 'node:test';
import assert from 'node:assert/strict';
import {QUOTE_HEADERS,quoteRow,quoteMetadataId,storeQuote} from '../src/quote-sheets.mjs';

const REF='TS-0123456789ABCDEF0123';
const RECEIVED=1762790400000;
const ENV={QUOTE_CRM_ENABLED:'true'};
const DATA={name:'Teste sintético',email:'synthetic@example.invalid',company:'Exemplo',service:'Excel',
  goal:'Poupar tempo',frequency:'Mensalmente',startingPoint:'Criar de raiz',tools:'Excel',specifics:'Relatório',
  deadline:'A definir',budget:'A definir',description:'Exclusivamente um teste local sem Google ou emails reais.'};

function fixture({onBatch,metadataId,properties=[{properties:{sheetId:37,title:'Pedidos do Site'}}]}={}){
  const values=[QUOTE_HEADERS.slice()],markers=new Map();
  const calls={batches:[],committed:0,metadataGets:0,properties:0};
  function commit(requests){
    assert.equal(requests.length,2);
    const marker=requests[0].createDeveloperMetadata.developerMetadata;
    const append=requests[1].appendCells;
    if(markers.has(marker.metadataId))return Response.json({error:{code:400}},{status:400});
    assert.equal(marker.metadataKey,'tq');assert.equal(marker.metadataValue,undefined);
    assert.deepEqual(marker.location,{sheetId:37});assert.equal(marker.visibility,'DOCUMENT');
    assert.equal(append.sheetId,37);assert.equal(append.fields,'userEnteredValue');
    assert.equal(append.rows.length,1);assert.equal(append.rows[0].values.length,18);
    const row=append.rows[0].values.map(cell=>{
      assert.deepEqual(Object.keys(cell),['userEnteredValue']);
      assert.deepEqual(Object.keys(cell.userEnteredValue),['stringValue']);
      assert.equal(typeof cell.userEnteredValue.stringValue,'string');
      return cell.userEnteredValue.stringValue;
    });
    // Modelo de transação: validar tudo antes de aplicar as duas alterações juntas.
    markers.set(marker.metadataId,structuredClone(marker));values.push(row);calls.committed++;
    return Response.json({replies:[{createDeveloperMetadata:{developerMetadata:marker}},{}]});
  }
  async function fetcher(raw,init={}){
    const url=new URL(raw);
    if(url.pathname.endsWith(':batchUpdate')){
      assert.equal(init.method,'POST');
      const requests=JSON.parse(init.body).requests;
      calls.batches.push(structuredClone(requests));
      return onBatch?onBatch({requests,commit,calls,values,markers}):commit(requests);
    }
    if(url.pathname.includes('/developerMetadata/')){
      calls.metadataGets++;
      const id=Number(url.pathname.split('/').at(-1));
      return markers.has(id)?Response.json(markers.get(id)):Response.json({error:{code:404}},{status:404});
    }
    if(url.searchParams.has('fields')){
      calls.properties++;assert.equal(url.searchParams.get('fields'),'sheets(properties(sheetId,title))');
      return Response.json({sheets:properties});
    }
    assert.equal(decodeURIComponent(url.pathname).split('/values/')[1],"'Pedidos do Site'!A1:R10000");
    return Response.json({values:structuredClone(values)});
  }
  return {values,markers,calls,commit,options:{fetcher,authorize:async()=> 'synthetic-access',...(metadataId?{metadataId}:{})}};
}

test('N chamadas concorrentes para a mesma referência registam uma única linha e marcador',async()=>{
  const f=fixture();
  const results=await Promise.all(Array.from({length:12},()=>storeQuote(ENV,DATA,REF,RECEIVED,f.options)));
  assert.equal(results.filter(result=>!result.duplicate).length,1);
  assert.equal(results.filter(result=>result.duplicate).length,11);
  assert.ok(results.every(result=>result.rowNumber===2&&result.reference===REF));
  assert.equal(f.values.length,2);assert.equal(f.markers.size,1);assert.equal(f.calls.committed,1);
});

test('referências diferentes concorrentes mantêm todas as linhas sem sobreposição',async()=>{
  const f=fixture(),refs=Array.from({length:8},(_,index)=>'TS-'+index.toString(16).toUpperCase().padStart(20,'0'));
  await Promise.all(refs.map(reference=>storeQuote(ENV,DATA,reference,RECEIVED,f.options)));
  assert.equal(f.values.length,9);assert.equal(f.markers.size,8);assert.equal(f.calls.committed,8);
  assert.deepEqual(new Set(f.values.slice(1).map(row=>row[0])),new Set(refs));
});

test('mesma referência com payload diferente em concorrência falha sem acrescentar outra linha',async()=>{
  const f=fixture(),other={...DATA,email:'different@example.invalid'};
  const results=await Promise.allSettled([storeQuote(ENV,DATA,REF,RECEIVED,f.options),storeQuote(ENV,other,REF,RECEIVED,f.options)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.message,'sheets_payload_conflict');
  assert.equal(f.values.length,2);assert.equal(f.markers.size,1);
});

test('timeout antes de aplicar o batch não cria cache negativo e nova tentativa usa o mesmo ID',async()=>{
  const f=fixture({onBatch:({requests,commit,calls})=>{
    if(calls.batches.length===1)throw Error('synthetic_timeout');
    return commit(requests);
  }});
  await assert.rejects(storeQuote(ENV,DATA,REF,RECEIVED,f.options),/synthetic_timeout/);
  assert.equal(f.values.length,1);assert.equal(f.markers.size,0);
  const retry=await storeQuote(ENV,DATA,REF,RECEIVED,f.options);
  assert.equal(retry.duplicate,false);assert.equal(f.values.length,2);
  assert.equal(f.calls.batches[0][0].createDeveloperMetadata.developerMetadata.metadataId,
    f.calls.batches[1][0].createDeveloperMetadata.developerMetadata.metadataId);
});

test('resposta perdida depois do commit é recuperada sem nova escrita',async()=>{
  const f=fixture({onBatch:({requests,commit,calls})=>{
    const response=commit(requests);if(calls.batches.length===1)throw Error('synthetic_response_lost');return response;
  }});
  await assert.rejects(storeQuote(ENV,DATA,REF,RECEIVED,f.options),/synthetic_response_lost/);
  const retry=await storeQuote(ENV,DATA,REF,RECEIVED,f.options);
  assert.equal(retry.duplicate,true);assert.equal(f.calls.batches.length,1);assert.equal(f.values.length,2);
});

test('resposta 200 sem confirmar o marcador não anuncia inserção; repetir recupera a linha existente',async()=>{
  const f=fixture({onBatch:({requests,commit})=>{commit(requests);return Response.json({replies:[]});}});
  await assert.rejects(storeQuote(ENV,DATA,REF,RECEIVED,f.options),/sheets_insert_unconfirmed/);
  assert.equal((await storeQuote(ENV,DATA,REF,RECEIVED,f.options)).duplicate,true);
  assert.equal(f.values.length,2);assert.equal(f.calls.committed,1);assert.equal(f.calls.batches.length,1);
});

test('um batch antigo que chega depois da tentativa seguinte não acrescenta outra linha',async()=>{
  let pending;
  const f=fixture({onBatch:({requests,commit,calls})=>{
    if(calls.batches.length===1){pending=()=>commit(requests);throw Error('synthetic_timeout_with_pending_server');}
    return commit(requests);
  }});
  await assert.rejects(storeQuote(ENV,DATA,REF,RECEIVED,f.options),/synthetic_timeout_with_pending_server/);
  const retry=await storeQuote(ENV,DATA,REF,RECEIVED,f.options);
  assert.equal(retry.duplicate,false);
  assert.equal(pending().status,400);
  assert.equal(f.values.length,2);assert.equal(f.markers.size,1);assert.equal(f.calls.committed,1);
});

test('um batch antigo que termina antes da nova tentativa também é recuperado',async()=>{
  let pending;
  const f=fixture({onBatch:({requests,commit,calls})=>{
    if(calls.batches.length===1){pending=()=>commit(requests);throw Error('synthetic_timeout');}
    return commit(requests);
  }});
  await assert.rejects(storeQuote(ENV,DATA,REF,RECEIVED,f.options),/synthetic_timeout/);
  assert.equal(pending().status,200);
  assert.equal((await storeQuote(ENV,DATA,REF,RECEIVED,f.options)).duplicate,true);
  assert.equal(f.calls.batches.length,1);assert.equal(f.values.length,2);
});

test('colisão de ID pertencente a outro marcador usa próximo candidato sem o alterar',async()=>{
  const f=fixture({metadataId:async(_ref,candidate)=>40+candidate});
  const foreign={metadataId:40,metadataKey:'foreign',metadataValue:'keep',location:{sheetId:99}};
  f.markers.set(40,structuredClone(foreign));
  const result=await storeQuote(ENV,DATA,REF,RECEIVED,f.options);
  assert.equal(result.duplicate,false);assert.deepEqual(f.markers.get(40),foreign);
  assert.equal(f.markers.has(41),true);assert.equal(f.calls.metadataGets,1);
  assert.equal(f.calls.batches.length,2);assert.equal(f.calls.committed,1);assert.equal(f.values.length,2);
});

test('oito colisões têm limite definido e não removem marcadores ou linhas',async()=>{
  const f=fixture({metadataId:async(_ref,candidate)=>100+candidate});
  for(let id=100;id<108;id++)f.markers.set(id,{metadataId:id,metadataKey:'foreign'});
  await assert.rejects(storeQuote(ENV,DATA,REF,RECEIVED,f.options),/sheets_metadata_collision_limit/);
  assert.equal(f.calls.batches.length,8);assert.equal(f.markers.size,8);assert.equal(f.values.length,1);
});

test('erro 400 sem ID ocupado e falha 503 não são tratados como colisões',async()=>{
  for(const status of [400,503]){
    const f=fixture({onBatch:()=>Response.json({error:{}},{status})});
    await assert.rejects(storeQuote(ENV,DATA,REF,RECEIVED,f.options),new RegExp('sheets_api_'+status));
    assert.equal(f.calls.batches.length,1);assert.equal(f.calls.metadataGets,status===400?1:0);
    assert.equal(f.markers.size,0);assert.equal(f.values.length,1);
  }
});

test('linhas antigas sem marcador são reutilizadas e payload alterado ou duplicado preexistente é rejeitado',async()=>{
  const f=fixture(),row=quoteRow(DATA,REF,RECEIVED);row[14]='Em análise';f.values.push(row);
  const result=await storeQuote(ENV,DATA,REF,RECEIVED+1000,f.options);
  assert.equal(result.duplicate,true);assert.equal(result.status,'Em análise');
  assert.equal(f.calls.batches.length,0);assert.equal(f.calls.properties,0);
  for(const change of [{email:'other@example.invalid'},{description:'Outra descrição para um projeto diferente.'}]){
    await assert.rejects(storeQuote(ENV,{...DATA,...change},REF,RECEIVED,f.options),/sheets_payload_conflict/);
  }
  f.values.push([...row]);
  await assert.rejects(storeQuote(ENV,DATA,REF,RECEIVED,f.options),/sheets_duplicate_or_missing/);
  assert.equal(f.values.length,3);assert.equal(f.calls.batches.length,0);
});

test('fórmulas mantêm-se stringValue literal e marcador compacto não contém conteúdo do pedido',async()=>{
  const f=fixture(),data={...DATA,name:'=1+1',description:'=IMPORTXML("https://invalid.example/","//x")'};
  await storeQuote(ENV,data,REF,RECEIVED,f.options);
  assert.equal(f.values[1][2],data.name);assert.equal(f.values[1][13],data.description);
  const marker=[...f.markers.values()][0];
  assert.equal(marker.metadataKey.length,2);assert.equal('metadataValue' in marker,false);
  assert.equal(JSON.stringify(marker).includes(data.email),false);assert.equal(JSON.stringify(marker).includes(REF),false);
});

test('título errado e limite de linhas são rejeitados antes de criar qualquer marcador',async()=>{
  const wrong=fixture({properties:[{properties:{sheetId:37,title:'Outro separador'}}]});
  await assert.rejects(storeQuote(ENV,DATA,REF,RECEIVED,wrong.options),/sheets_sheet_mismatch/);
  assert.equal(wrong.calls.batches.length,0);
  const full=fixture();
  for(let i=1;i<9999;i++)full.values.push(['TS-'+i.toString(16).toUpperCase().padStart(20,'0')]);
  await assert.rejects(storeQuote(ENV,DATA,REF,RECEIVED,full.options),/sheets_read_limit/);
  assert.equal(full.calls.batches.length,0);assert.equal(full.calls.properties,0);
});

test('IDs são determinísticos, positivos e válidos no intervalo int32',async()=>{
  const first=await quoteMetadataId(REF,0);
  assert.equal(first,await quoteMetadataId(REF,0));assert.ok(first>0&&first<=0x7fffffff);
  assert.notEqual(first,await quoteMetadataId(REF,1));
  await assert.rejects(quoteMetadataId('INVALID',0),/quote_reference_invalid/);
  await assert.rejects(quoteMetadataId(REF,8),/quote_reference_invalid/);
});
