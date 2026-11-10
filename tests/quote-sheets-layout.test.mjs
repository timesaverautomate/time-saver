import test from 'node:test';
import assert from 'node:assert/strict';
import {QUOTE_HEADERS,quoteRow,storeQuote,markQuoteReceived} from '../src/quote-sheets.mjs';

const REF='TS-ABCDEF0123456789ABCD';
const OTHER='TS-11111111111111111111';
const DATA={name:'Exemplo fictício',email:'teste@example.invalid',company:'Teste',
  service:'Excel',description:'Dados fictícios exclusivos para testes sem rede.'};
function fixture(){
  const values=[QUOTE_HEADERS.slice()];
  const calls={append:0,update:0};
  async function fetcher(raw,init={}){
    const url=new URL(raw);
    if(url.pathname.endsWith(':append')){
      calls.append++;
      assert.equal(decodeURIComponent(url.pathname).split('/values/')[1],"'Pedidos do Site'!A:R:append");
      assert.equal(url.searchParams.get('insertDataOption'),'OVERWRITE');
      assert.equal(url.searchParams.get('valueInputOption'),'RAW');
      const data=JSON.parse(init.body).values;
      assert.equal(data.length,1);
      assert.equal(data[0].length,18);
      values.push(...data);
      return Response.json({updates:{updatedRows:1}});
    }
    if(url.pathname.endsWith('/values:batchUpdate')){
      calls.update++;
      const updates=JSON.parse(init.body).data;
      const n=Number(updates[0].range.match(/!O(\d+)$/)[1]);
      values[n-1][14]=updates[0].values[0][0];
      values[n-1][16]=updates[1].values[0][0];
      values[n-1][17]=updates[1].values[0][1];
      return Response.json({totalUpdatedRows:1});
    }
    assert.equal(decodeURIComponent(url.pathname).split('/values/')[1],"'Pedidos do Site'!A1:R10000");
    return Response.json({values});
  }
  return {values,calls,fetcher,options:{fetcher,authorize:async()=> 'mock-token'}};
}

test('novos pedidos preenchem linhas formatadas sem INSERT_ROWS ou outro separador',async()=>{
  const f=fixture();
  const entry=await storeQuote({QUOTE_CRM_ENABLED:'true'},DATA,REF,Date.now(),f.options);
  assert.equal(entry.reference,REF);
  assert.equal(entry.rowNumber,2);
  assert.equal(f.values[1][2],DATA.name);
  assert.equal(f.calls.append,1);
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
  f.values.splice(1,0,quoteRow(DATA,OTHER,Date.now()));
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
