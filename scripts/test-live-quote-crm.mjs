// Teste interno com dados fictícios: envia apenas para o destinatário fixo do formulário.
import {googleToken,QUOTE_SHEET_ID} from '../src/quote-sheets.mjs';
import {randomUUID} from 'node:crypto';
const env=process.env;
if(env.GITHUB_REPOSITORY_ID!=='1452563434'
  ||env.GITHUB_REPOSITORY!=='timesaverautomate/time-saver'
  ||env.GITHUB_REF!=='refs/heads/main')throw Error('Contexto não autorizado');
const origin='https://timesaverautomate.com';
const get=await fetch(origin+'/api/form-status',{
  headers:{Origin:origin},redirect:'error',signal:AbortSignal.timeout(12000)
});
if(!get.ok)throw Error('form_status_unavailable');
const token=await get.json();
if(token.available!==true||typeof token.token!=='string')throw Error('form_token_unavailable');
await new Promise(r=>setTimeout(r,2100));
const request={
  name:'Teste técnico CRM TimeSaver',
  email:'timesaverautomate@gmail.com',
  company:'Time Saver - teste interno',
  description:'Pedido exclusivamente fictício para verificar a sincronização entre o formulário e o CRM. Não representa um cliente real.',
  service:'Excel',
  goal:'Poupar tempo',
  frequency:'Pontualmente',
  startingPoint:'Criar de raiz',
  deadline:'A definir',
  budget:'A definir',
  tools:'',
  specifics:'',
  website:'',
  token:token.token
};
const sent=await fetch(origin+'/api/quote',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
  headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID()},
  body:JSON.stringify(request)
});
const accepted=await sent.json();
if(!sent.ok||accepted.accepted!==true||!/^TS-[A-F0-9]{20}$/.test(accepted.reference||'')){
  throw Error('quote_submission_not_confirmed_http_'+sent.status);
}
const tokenGoogle=await googleToken({
  GOOGLE_SERVICE_ACCOUNT_JSON:env.GOOGLE_SERVICE_ACCOUNT_JSON
});
const api='https://sheets.googleapis.com/v4/spreadsheets/'+QUOTE_SHEET_ID
  +'/values/'+encodeURIComponent("'Pedidos do Site'!A1:R10000");
const response=await fetch(api,{
  headers:{Authorization:'Bearer '+tokenGoogle},redirect:'error',signal:AbortSignal.timeout(12000)
});
if(!response.ok)throw Error('sheets_verification_http_'+response.status);
const rows=(await response.json()).values||[];
const found=rows.filter((r,i)=>i>0&&r[0]===accepted.reference);
if(found.length!==1||found[0][14]!=='Novo'||found[0][15]!=='Website'){
  throw Error('crm_quote_missing_or_not_confirmed');
}
console.log('TESTE REAL CONFIRMADO: referência '+accepted.reference+'; uma linha no CRM; estado Novo.');
console.log('Foi enviado um único email transacional de teste para o endereço da própria TimeSaver.');
