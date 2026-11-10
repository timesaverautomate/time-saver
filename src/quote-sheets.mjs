// Registo privado dos pedidos recebidos pelo formulário TimeSaver.
// Nunca expor chaves de serviço à página, logs ou respostas públicas.
export const QUOTE_SHEET_ID = '1VYEBWJb_9cYGbO8nZa3d_qh1rLUH-H3xf-w4CnOLMS4';
export const QUOTE_HEADERS = [
  'Referência','Data/hora UTC','Nome','Email','Empresa','Serviço','Objetivo',
  'Frequência','Ponto de partida','Ferramentas','Detalhes','Prazo','Orçamento',
  'Descrição do pedido','Estado','Canal','Última atualização UTC','ID Resend'
];
const ROOT='https://sheets.googleapis.com/v4/spreadsheets/'+QUOTE_SHEET_ID;
const RANGE=encodeURIComponent("'Pedidos do Site'!A1:R10000");
const APPEND=encodeURIComponent("'Pedidos do Site'!A:R");
const TOKEN='https://oauth2.googleapis.com/token';

function b64url(input){
  return btoa(input).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function toBinary(bytes){
  let result='';
  for(let i=0;i<bytes.length;i++)result+=String.fromCharCode(bytes[i]);
  return result;
}
function safeField(value,limit=4000){
  return String(value??'').normalize('NFC').slice(0,limit);
}
export function quoteRow(data,reference,received){
  return [
    reference,new Date(received).toISOString(),safeField(data.name,100),
    safeField(data.email,254),safeField(data.company,160),
    safeField(data.service,100),safeField(data.goal,100),
    safeField(data.frequency,80),safeField(data.startingPoint,120),
    safeField(data.tools,500),safeField(data.specifics,500),
    safeField(data.deadline,100),safeField(data.budget,100),
    safeField(data.description,4000),'Pendente envio','Website',
    new Date(received).toISOString(),''
  ];
}
export async function googleToken(env,fetcher=fetch){
  const raw=env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if(typeof raw!=='string'||raw.length<100||raw.length>12000)throw Error('sheets_secret_missing');
  const service=JSON.parse(raw);
  if(service.type!=='service_account'
    ||typeof service.client_email!=='string'
    ||typeof service.private_key!=='string'
    ||service.token_uri!==TOKEN)throw Error('sheets_secret_invalid');
  const pem=service.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g,'');
  const bytes=Uint8Array.from(atob(pem),x=>x.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',bytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const body=b64url(JSON.stringify({
    iss:service.client_email,
    scope:'https://www.googleapis.com/auth/spreadsheets',
    aud:TOKEN,iat:now,exp:now+2400
  }));
  const payload=header+'.'+body;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(payload));
  const signed=payload+'.'+b64url(toBinary(new Uint8Array(signature)));
  const response=await fetcher(TOKEN,{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000),
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signed}).toString()
  });
  if(!response.ok)throw Error('sheets_auth_failed');
  const data=await response.json();
  if(typeof data.access_token!=='string'||!data.access_token)throw Error('sheets_auth_invalid');
  return data.access_token;
}
async function sheetCall(url,access,fetcher,init={}){
  const response=await fetcher(url,{
    redirect:'manual',signal:AbortSignal.timeout(12000),
    ...init,headers:{Authorization:'Bearer '+access,...(init.headers||{})}
  });
  if(!response.ok)throw Error('sheets_api_'+response.status);
  return response.json();
}
async function rows(access,fetcher){
  const result=await sheetCall(ROOT+'/values/'+RANGE,access,fetcher);
  const all=result.values||[];
  if(!Array.isArray(all)||JSON.stringify(all[0])!==JSON.stringify(QUOTE_HEADERS))
    throw Error('sheets_header_mismatch');
  if(all.length>=10000)throw Error('sheets_read_limit');
  return all;
}
export async function verifyQuoteSheet(env,{fetcher=fetch,authorize=googleToken}={}){
  let access;
  try{access=await authorize(env,fetcher);}
  catch(error){
    if(/^sheets_[a-z0-9_]+$/.test(error?.message||''))throw error;
    throw Error('sheets_auth_runtime_'+(error?.name||'unknown').toLowerCase().replace(/[^a-z]/g,''));
  }
  let all;
  try{all=await rows(access,fetcher);}
  catch(error){
    if(/^sheets_[a-z0-9_]+$/.test(error?.message||''))throw error;
    throw Error('sheets_read_runtime_'+(error?.name||'unknown').toLowerCase().replace(/[^a-z]/g,''));
  }
  return {ready:true,existingRows:all.length-1};
}

export async function storeQuote(env,data,reference,received,{
  fetcher=fetch,authorize=googleToken
}={}){
  if(env.QUOTE_CRM_ENABLED!=='true')return null;
  if(!/^TS-[A-F0-9]{20}$/.test(reference))throw Error('quote_reference_invalid');
  const access=await authorize(env,fetcher);
  const all=await rows(access,fetcher);
  const found=all.findIndex((r,i)=>i>0&&r[0]===reference);
  if(found>=0)return {access,rowNumber:found+1,status:all[found][14]||'',duplicate:true};
  const row=quoteRow(data,reference,received);
  const result=await sheetCall(ROOT+'/values/'+APPEND+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',access,fetcher,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:[row]})
  });
  if(result.updates?.updatedRows!==1)throw Error('sheets_insert_unconfirmed');
  const verified=await rows(access,fetcher);
  const match=verified.map((r,i)=>r[0]===reference?i:-1).filter(i=>i>0);
  if(match.length!==1)throw Error('sheets_duplicate_or_missing');
  return {access,rowNumber:match[0]+1,status:'Pendente envio',duplicate:false};
}
export async function markQuoteReceived(entry,providerId,{
  fetcher=fetch
}={}){
  if(!entry||entry.status!=='Pendente envio')return;
  const n=entry.rowNumber;
  if(!Number.isInteger(n)||n<2||n>10000)throw Error('sheets_row_invalid');
  const iso=new Date().toISOString();
  await sheetCall(ROOT+'/values:batchUpdate',entry.access,fetcher,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({valueInputOption:'RAW',data:[
      {range:"'Pedidos do Site'!O"+n,values:[['Novo']]},
      {range:"'Pedidos do Site'!Q"+n+":R"+n,values:[[iso,String(providerId||'').slice(0,100)]]}
    ]})
  });
}
