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
const TOKEN='https://oauth2.googleapis.com/token';
const QUOTE_TAB='Pedidos do Site';
const MARKER_KEY='tq';
const MAX_MARKER_CANDIDATES=8;

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
    safeField(data.service,300),safeField(data.goal,100),
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

export async function quoteMetadataId(reference,candidate=0){
  if(!/^TS-[A-F0-9]{20}$/.test(reference)||!Number.isInteger(candidate)||candidate<0||candidate>=MAX_MARKER_CANDIDATES)
    throw Error('quote_reference_invalid');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(
    'time-saver-quote-marker-v1:'+QUOTE_SHEET_ID+':'+reference+':'+candidate));
  return (new DataView(digest).getUint32(0,false)&0x7fffffff)||1;
}
function existingQuote(all,data,reference,access){
  const matches=all.map((row,index)=>index>0&&row[0]===reference?index:-1).filter(index=>index>0);
  if(matches.length>1)throw Error('sheets_duplicate_or_missing');
  if(matches.length===0)return null;
  const index=matches[0],expected=quoteRow(data,reference,0),row=all[index];
  for(let column=2;column<=13;column++){
    if(String(row[column]??'').normalize('NFC')!==expected[column])throw Error('sheets_payload_conflict');
  }
  return {access,reference,rowNumber:index+1,status:row[14]||'',duplicate:true};
}
async function quoteSheetId(access,fetcher){
  const result=await sheetCall(ROOT+'?fields=sheets(properties(sheetId,title))',access,fetcher);
  if(!Array.isArray(result.sheets))throw Error('sheets_sheet_mismatch');
  const matches=result.sheets.map(sheet=>sheet.properties).filter(properties=>properties?.title===QUOTE_TAB);
  const id=matches[0]?.sheetId;
  if(matches.length!==1||!Number.isInteger(id)||id<0||id>0x7fffffff)throw Error('sheets_sheet_mismatch');
  return id;
}
export async function storeQuote(env,data,reference,received,{
  fetcher=fetch,authorize=googleToken,metadataId=quoteMetadataId
}={}){
  if(env.QUOTE_CRM_ENABLED!=='true')return null;
  if(!/^TS-[A-F0-9]{20}$/.test(reference))throw Error('quote_reference_invalid');
  const access=await authorize(env,fetcher);
  const all=await rows(access,fetcher);
  const found=existingQuote(all,data,reference,access);
  if(found)return found;
  // O leitor recusa >=10000 linhas: não criar uma linha que já não possa confirmar.
  if(all.length>=9999)throw Error('sheets_read_limit');
  const sheetId=await quoteSheetId(access,fetcher);
  const row=quoteRow(data,reference,received);
  for(let candidate=0;candidate<MAX_MARKER_CANDIDATES;candidate++){
    const id=await metadataId(reference,candidate);
    if(!Number.isInteger(id)||id<=0||id>0x7fffffff)throw Error('sheets_metadata_invalid');
    // Sheets aplica o marcador único e a linha no mesmo batch atómico. Um ID já
    // ocupado faz falhar o batch inteiro, sem acrescentar outra linha. O marcador
    // não contém nome, email ou descrição, não expira e não é removido pela aplicação.
    const requests=[
      {createDeveloperMetadata:{developerMetadata:{metadataId:id,metadataKey:MARKER_KEY,
        location:{sheetId},visibility:'DOCUMENT'}}},
      {appendCells:{sheetId,rows:[{values:row.map(value=>({userEnteredValue:{stringValue:String(value)}}))}],
        fields:'userEnteredValue'}}
    ];
    let result;
    try{
      result=await sheetCall(ROOT+':batchUpdate',access,fetcher,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests})
      });
    }catch(error){
      if(error?.message!=='sheets_api_400')throw error;
      let occupied;
      try{occupied=await sheetCall(ROOT+'/developerMetadata/'+id,access,fetcher);}
      catch(lookupError){
        if(lookupError?.message==='sheets_api_404')throw error;
        throw lookupError;
      }
      if(occupied?.metadataId!==id)throw Error('sheets_metadata_invalid');
      const current=await rows(access,fetcher);
      const duplicate=existingQuote(current,data,reference,access);
      if(duplicate)return duplicate;
      // ID ocupado por outro pedido/aplicação; não alterar nem apagar o marcador.
      // O candidato seguinte é determinístico para todos os executores.
      continue;
    }
    if(result?.replies?.[0]?.createDeveloperMetadata?.developerMetadata?.metadataId!==id)
      throw Error('sheets_insert_unconfirmed');
    const verified=await rows(access,fetcher);
    const inserted=existingQuote(verified,data,reference,access);
    if(!inserted)throw Error('sheets_duplicate_or_missing');
    return {...inserted,duplicate:false};
  }
  throw Error('sheets_metadata_collision_limit');
}
export async function markQuoteReceived(entry,providerId,{
  fetcher=fetch
}={}){
  if(!entry||entry.status!=='Pendente envio')return;
  if(!/^TS-[A-F0-9]{20}$/.test(entry.reference||''))throw Error('quote_reference_invalid');
  // Uma ordenação manual pode mudar a posição. Localizar novamente pela referência
  // e preservar um estado que o utilizador já tenha atualizado entretanto.
  const current=await rows(entry.access,fetcher);
  const matches=current.map((r,i)=>i>0&&r[0]===entry.reference?i:-1).filter(i=>i>0);
  if(matches.length!==1)throw Error('sheets_duplicate_or_missing');
  const n=matches[0]+1;
  if(current[n-1][14]!=='Pendente envio')return;
  const iso=new Date().toISOString();
  await sheetCall(ROOT+'/values:batchUpdate',entry.access,fetcher,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({valueInputOption:'RAW',data:[
      {range:"'Pedidos do Site'!O"+n,values:[['Novo']]},
      {range:"'Pedidos do Site'!Q"+n+":R"+n,values:[[iso,String(providerId||'').slice(0,100)]]}
    ]})
  });
}
