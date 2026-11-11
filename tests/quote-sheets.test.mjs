import test from 'node:test';
import assert from 'node:assert/strict';
import {QUOTE_HEADERS,quoteRow,storeQuote,markQuoteReceived} from '../src/quote-sheets.mjs';

const REF='TS-0123456789ABCDEF0123';
const DATA={
  name:'Pessoa de Teste',email:'test@example.net',company:'Empresa Teste',
  service:'Excel',goal:'Poupar tempo',frequency:'Mensalmente',
  startingPoint:'Criar de raiz',tools:'Excel',specifics:'Integração',
  deadline:'Sem prazo definido',budget:'Até 500 €',
  description:'Descrição inventada para um teste isolado, sem email real.'
};
function fakeSheet(){
  const values=[QUOTE_HEADERS.slice()];
  const metadata=new Map();
  let appends=0, updates=0;
  async function fetcher(url,init={}){
    const u=String(url);
    if(u.endsWith(':batchUpdate')&&!u.endsWith('/values:batchUpdate')){
      assert.equal(init.method,'POST');
      const payload=JSON.parse(init.body);
      const marker=payload.requests[0].createDeveloperMetadata.developerMetadata;
      const append=payload.requests[1].appendCells;
      if(metadata.has(marker.metadataId))return Response.json({error:{}},{status:400});
      assert.equal(marker.metadataKey,'tq');assert.equal(marker.metadataValue,undefined);
      assert.equal(append.sheetId,37);assert.equal(append.fields,'userEnteredValue');
      metadata.set(marker.metadataId,marker);appends++;
      values.push(...append.rows.map(row=>row.values.map(cell=>cell.userEnteredValue.stringValue)));
      return Response.json({replies:[{createDeveloperMetadata:{developerMetadata:marker}},{}]});
    }
    if(u.endsWith('/values:batchUpdate')){
      updates++;
      assert.equal(JSON.parse(init.body).valueInputOption,'RAW');
      const entries=JSON.parse(init.body).data;
      const rowNumber=Number(entries[0].range.match(/O(\d+)/)?.[1]||0);
      values[rowNumber-1][14]='Novo';
      values[rowNumber-1][16]=entries[1].values[0][0];
      values[rowNumber-1][17]=entries[1].values[0][1];
      return Response.json({totalUpdatedRows:1});
    }
    if(u.includes('/developerMetadata/')){
      const id=Number(u.split('/').at(-1));
      return metadata.has(id)?Response.json(metadata.get(id)):Response.json({error:{}},{status:404});
    }
    if(u.includes('?fields='))return Response.json({sheets:[{properties:{sheetId:37,title:'Pedidos do Site'}}]});
    if(u.includes('/values/')&&!u.includes(':append'))return Response.json({values});
    throw Error('Unexpected mocked URL: '+u);
  }
  return {fetcher,values,stats:()=>({appends,updates})};
}
const options=(s)=>({fetcher:s.fetcher,authorize:async()=> 'test-token'});

test('A linha respeita o cabeçalho e não executa fórmulas',()=>{
  const row=quoteRow({...DATA,name:'=1+1'},REF,1762790400000);
  assert.equal(row.length,QUOTE_HEADERS.length);
  assert.equal(row[2],'=1+1');
  assert.equal(row[14],'Pendente envio');
  assert.equal(row[15],'Website');
});

test('Pedido entra uma única vez por referência e depois atualiza o estado',async()=>{
  const s=fakeSheet(),env={QUOTE_CRM_ENABLED:'true'};
  const first=await storeQuote(env,DATA,REF,1762790400000,options(s));
  assert.equal(first.rowNumber,2);
  assert.equal(first.duplicate,false);
  await markQuoteReceived(first,'resend-test-id',{fetcher:s.fetcher});
  const again=await storeQuote(env,DATA,REF,1762790400000,options(s));
  assert.equal(again.duplicate,true);
  assert.equal(again.status,'Novo');
  await markQuoteReceived(again,'ignored',{fetcher:s.fetcher});
  assert.deepEqual(s.stats(),{appends:1,updates:1});
  assert.equal(s.values[1][3],'test@example.net');
  assert.equal(s.values[1][17],'resend-test-id');
});

test('O registo fica desativado quando não existe autorização',async()=>{
  const s=fakeSheet();
  assert.equal(await storeQuote({QUOTE_CRM_ENABLED:'false'},DATA,REF,1762790400000,options(s)),null);
  assert.deepEqual(s.stats(),{appends:0,updates:0});
});

test('O cabeçalho errado bloqueia a inserção',async()=>{
  const s=fakeSheet();s.values[0][0]='Outro';
  await assert.rejects(storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,1762790400000,options(s)),/header_mismatch/);
  assert.equal(s.stats().appends,0);
});

test('Referência inválida nunca escreve',async()=>{
  const s=fakeSheet();
  await assert.rejects(storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,'INVALID',1762790400000,options(s)),/reference_invalid/);
  assert.equal(s.stats().appends,0);
});
