import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteSheetFixture} from './quote-sheet-fixture.mjs';
import {QUOTE_HEADERS,quoteRow,storeQuote,markQuoteReceived} from '../src/quote-sheets.mjs';

const REF='TS-ABCDEF0123456789ABCD';
const OTHER='TS-11111111111111111111';
const DATA={name:'Exemplo fictício',email:'teste@example.invalid',company:'Teste',
  service:'Excel',description:'Dados fictícios exclusivos para testes sem rede.'};
const fixture=quoteSheetFixture;

test('append atómico só escreve valores no separador previsto e preserva formatos existentes',async()=>{
  const f=fixture();
  const entry=await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),f.options);
  assert.equal(entry.reference,REF);
  assert.equal(entry.rowNumber,2);
  assert.equal(f.values[1][2],DATA.name);
  assert.equal(f.calls.append,1);
  assert.deepEqual(f.formats,{1:{foreground:'white'},2:{foreground:'black',wrap:true}});
});

test('repetir a mesma referência não acrescenta outra linha',async()=>{
  const f=fixture();
  await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),f.options);
  const repeat=await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),f.options);
  assert.equal(repeat.duplicate,true);
  assert.equal(f.calls.append,1);
  assert.equal(f.values.length,2);
});

test('confirmação localiza a referência depois de uma ordenação da folha',async()=>{
  const f=fixture();
  const entry=await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),f.options);
  f.insertAt(1,quoteRow(DATA,OTHER,Date.now()));
  await markQuoteReceived(entry,'mock-id',{fetcher:f.fetcher});
  assert.equal(f.values[1][0],OTHER);
  assert.equal(f.values[1][14],'Pendente envio');
  assert.equal(f.values[2][0],REF);
  assert.equal(f.values[2][14],'Novo');
  assert.equal(f.values[2][17],'mock-id');
});

test('confirmação não substitui um estado já alterado pelo utilizador',async()=>{
  const f=fixture();
  const entry=await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),f.options);
  f.values[1][14]='Em análise';
  await markQuoteReceived(entry,'mock-id',{fetcher:f.fetcher});
  assert.equal(f.values[1][14],'Em análise');
  assert.equal(f.calls.update,0);
});

test('ordenar depois da leitura não atribui o email a outro pedido',async()=>{
  const f=quoteSheetFixture({onBeforeStatusUpdate:({reorder})=>reorder((a,b)=>b[0].localeCompare(a[0]))});
  const entry=await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),f.options);
  await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,OTHER,Date.now(),f.options);
  await markQuoteReceived(entry,'mock-reorder-id',{fetcher:f.fetcher});
  const correct=f.values.find(row=>row[0]===REF),other=f.values.find(row=>row[0]===OTHER);
  assert.equal(correct[14],'Novo');assert.equal(correct[17],'mock-reorder-id');
  assert.equal(other[14],'Pendente envio');assert.equal(other[17],'');
  assert.equal(f.calls.statusBodies[0].data[0].values[0][14],null);
});

test('estado manual alterado entre leitura e escrita nunca é substituído',async()=>{
  const f=quoteSheetFixture({onBeforeStatusUpdate:({values})=>{values.find(row=>row[0]===REF)[14]='Em análise';}});
  const entry=await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),f.options);
  await markQuoteReceived(entry,'mock-id',{fetcher:f.fetcher});
  assert.equal(f.values[1][14],'Em análise');assert.equal(f.values[1][17],'mock-id');
});

test('repetição encontra a âncora pelo ID determinístico e linhas antigas não têm escrita por posição',async()=>{
  const f=fixture();await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),f.options);
  const duplicate=await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),f.options);
  assert.equal(duplicate.rowMetadataId,undefined);
  await markQuoteReceived(duplicate,'mock-id',{fetcher:f.fetcher});assert.equal(f.calls.update,1);
  const old=fixture();old.values.push(quoteRow(DATA,REF,Date.now()));
  const legacy=await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),old.options);
  await assert.rejects(markQuoteReceived(legacy,'must-not-write',{fetcher:old.fetcher}),/sheets_row_marker_missing/);
  assert.equal(old.calls.update,0);assert.equal(old.values[1][17],'');
});

test('filtro não pode apontar a outro separador ou anunciar mais de uma linha',async()=>{
  for(const kind of ['wrong-tab','duplicate-range','wrong-ref']){
    const f=fixture(),entry=await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),f.options);
    const fetcher=async(url,init)=>{
      const response=await f.fetcher(url,init);
      if(!url.endsWith('/values:batchGetByDataFilter'))return response;
      const result=await response.json();
      if(kind==='wrong-tab')result.valueRanges[0].valueRange.range="'Outro'!A2:R2";
      if(kind==='duplicate-range')result.valueRanges.push(structuredClone(result.valueRanges[0]));
      if(kind==='wrong-ref')result.valueRanges[0].valueRange.values[0][0]=OTHER;
      return Response.json(result);
    };
    await assert.rejects(markQuoteReceived(entry,'mock-id',{fetcher}),/sheets_row_marker_(?:missing|mismatch)/);
    assert.equal(f.calls.update,0);
  }
});
