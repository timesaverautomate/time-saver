// Verificação só de leitura antes de publicar a sincronização de pedidos.
import {readFile} from 'node:fs/promises';
import {verifyQuoteSheet} from '../src/quote-sheets.mjs';
const config=JSON.parse(await readFile(new URL('../config/domain.json',import.meta.url),'utf8'));
if(config.quoteSheetSyncEnabled!==true){
  console.log('Integração de pedidos com Sheets desativada; preflight dispensado.');
}else{
  if(process.env.GITHUB_REPOSITORY_ID!=='1452563434'
    ||process.env.GITHUB_REPOSITORY!=='timesaverautomate/time-saver'
    ||process.env.GITHUB_REF!=='refs/heads/main'){
    throw Error('Contexto de publicação não autorizado.');
  }
  const result=await verifyQuoteSheet({
    GOOGLE_SERVICE_ACCOUNT_JSON:process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  });
  if(!result.ready)throw Error('CRM de pedidos indisponível.');
  console.log('Separador Pedidos do Site validado (acesso de leitura e cabeçalhos).');
}
