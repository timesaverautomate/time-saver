import { validateSubmission,readBoundedJSON,BodyTimeoutError } from './validation.mjs';
import { keyedHash,sameDigest,validDiagnosticToken } from './security.mjs';
import { storeQuote,markQuoteReceived,verifyQuoteSheet } from './quote-sheets.mjs';

const CONTACT_ORIGIN='https://timesaverautomate.com';
const CONTACT_TO='timesaverautomate@gmail.com';
const CONTACT_FROM='Time Saver <pedidos@timesaverautomate.com>';
const TICKET_LIFETIME=23*60*60*1000;

function contactEmail(data,reference,created){
  const rows=[['Referência',reference],['Formulário iniciado em (UTC)',new Date(created).toISOString()],
    ['Tipo de ajuda',data.service],['Objetivo principal',data.goal],['Frequência',data.frequency],
    ['Ponto de partida',data.startingPoint],['Nome',data.name],['Email de contacto',data.email],
    ['Empresa',data.company||'Não indicada'],['Ferramentas atuais',data.tools||'Não indicadas'],
    ['Detalhes específicos',data.specifics||'Não indicados'],['Prazo pretendido',data.deadline],
    ['Orçamento indicativo',data.budget]];
  return rows.map(([label,value])=>label+': '+value).join('\n')
    +'\n\nDescrição do processo e resultado pretendido:\n'+data.description
    +'\n\nPedido enviado pelo formulário Time Saver. Conteúdo fornecido pelo visitante; tratar como texto não fidedigno.';
}

export function contactConfigured(env){
  return env.FORM_ENABLED==='true' && /^re_[A-Za-z0-9_-]{8,256}$/.test(env.RESEND_API_KEY||'')
    && (env.QUOTE_CRM_ENABLED!=='true' || typeof env.GOOGLE_SERVICE_ACCOUNT_JSON==='string')
    && typeof env.SECURITY_HMAC_KEY==='string' && env.SECURITY_HMAC_KEY.length>=64
    && ['FORM_IP_RATE','FORM_EDGE_RATE','FORM_TOKEN_RATE'].every(key=>typeof env[key]?.limit==='function');
}
function contactJSON(value,status=200,extra={}){
  return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',...extra}});
}
function contactOrigin(request,required){
  const url=new URL(request.url),origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');
  return url.origin===CONTACT_ORIGIN && (!required&&!origin || origin===CONTACT_ORIGIN)
    && (!site||site==='same-origin');
}
export function contactNetworkSource(ip){
  if(typeof ip!=='string'||!ip||ip.length>64||!/^[a-f0-9:.]+$/i.test(ip))throw Error('edge_ip_invalid');
  if(!ip.includes(':')){
    const octets=ip.split('.');
    if(octets.length!==4||octets.some(part=>!/^(?:0|[1-9][0-9]{0,2})$/.test(part)||Number(part)>255))throw Error('edge_ip_invalid');
    return ip;
  }
  // URL valida/canonicaliza IPv6; expandimos apenas a representação já validada.
  let canonical;
  try{canonical=new URL('http://['+ip+']/').hostname.slice(1,-1);}catch{throw Error('edge_ip_invalid');}
  const halves=canonical.split('::');
  const left=halves[0]?halves[0].split(':'):[];
  const right=halves.length===2&&halves[1]?halves[1].split(':'):[];
  const words=halves.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
  if(words.length!==8||words.some(word=>!/^[0-9a-f]{1,4}$/.test(word)))throw Error('edge_ip_invalid');
  const values=words.map(word=>parseInt(word,16));
  // IPv4 mapeado partilha o limite do endereço IPv4, em vez de todo o prefixo ::/64.
  if(values.slice(0,5).every(value=>value===0)&&values[5]===0xffff){
    return [values[6]>>>8,values[6]&255,values[7]>>>8,values[7]&255].join('.');
  }
  // A rotação de endereços na mesma rede IPv6 não cria um limite novo.
  return 'ipv6/64:'+words.slice(0,4).map(word=>word.padStart(4,'0')).join(':');
}
async function contactSource(request,env){
  const source=contactNetworkSource(request.headers.get('CF-Connecting-IP'));
  const day=Math.floor(Date.now()/86400000);
  return keyedHash(env.SECURITY_HMAC_KEY,'contact-rate:'+day+':'+source);
}
export async function issueContactToken(env,now=Date.now()){
  const value=now+'.'+crypto.randomUUID();
  return value+'.'+await keyedHash(env.SECURITY_HMAC_KEY,'contact-ticket:'+value);
}
export async function parseContactToken(token,env,now=Date.now()){
  if(typeof token!=='string')return null;
  const parts=token.split('.');
  if(parts.length!==3||!/^\d{13}$/.test(parts[0])||!/^[a-f0-9-]{36}$/.test(parts[1])||!/^[a-f0-9]{64}$/.test(parts[2]))return null;
  const created=Number(parts[0]),age=now-created;
  if(age<1500||age>TICKET_LIFETIME)return null;
  const signature=await keyedHash(env.SECURITY_HMAC_KEY,'contact-ticket:'+parts[0]+'.'+parts[1]);
  return sameDigest(parts[2],signature)?{created,nonce:parts[1]}:null;
}
export async function handleContact(request,env,transport=fetch){
  const path=new URL(request.url).pathname;
  if(path==='/api/quote-crm-health'){
    if(request.method!=='GET'||!contactOrigin(request,false))return contactJSON({ready:false},403);
    if(!await validDiagnosticToken(request.headers.get('X-Time-Saver-Diagnostic'),env))return contactJSON({ready:false},403);
    if(env.QUOTE_CRM_ENABLED!=='true'||!contactConfigured(env))return contactJSON({ready:false,code:'crm_health_unavailable'},503);
    try{
      const source=await contactSource(request,env);
      const limited=await env.FORM_IP_RATE.limit({key:'diagnostic:'+source});
      if(!limited.success)return contactJSON({ready:false,code:'crm_health_rate_limited'},429,{'Retry-After':'60'});
      await verifyQuoteSheet(env);
      return contactJSON({ready:true});
    }catch(error){
      const known=/^sheets_[a-z0-9_]+$/.test(error?.message||'')?error.message:'sheets_runtime_error';
      return contactJSON({ready:false,code:known});
    }
  }
  if(!['/api/form-status','/api/quote'].includes(path))return contactJSON({message:'Página não encontrada.'},404);
  const method=path==='/api/form-status'?'GET':'POST';
  if(request.method!==method)return contactJSON({message:'Método não permitido.'},405,{Allow:method});
  if(!contactOrigin(request,method==='POST'))return contactJSON({message:'Não foi possível validar a origem do pedido.'},403);
  if(!contactConfigured(env))return contactJSON({available:false,version:'direct-email-v1',message:'O envio está temporariamente indisponível. Tente novamente mais tarde.'},method==='GET'?200:503);
  try{
    const source=await contactSource(request,env);
    if(method==='GET'){
      const limited=await env.FORM_TOKEN_RATE.limit({key:source});
      if(!limited.success)return contactJSON({available:false,message:'Aguarde um minuto e volte a tentar.'},429,{'Retry-After':'60'});
      return contactJSON({available:true,version:'direct-email-v1',token:await issueContactToken(env)});
    }
    const rateLimited=()=>contactJSON({message:'Foram feitas demasiadas tentativas. Aguarde um minuto antes de tentar novamente.'},429,{'Retry-After':'60'});
    const local=await env.FORM_IP_RATE.limit({key:source});
    if(!local.success)return rateLimited();
    if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return contactJSON({message:'Formato de pedido inválido.'},415);
    const key=request.headers.get('Idempotency-Key');
    if(!key||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key))return contactJSON({message:'Reabra o formulário e tente novamente.'},400);
    let body;
    try{body=await readBoundedJSON(request);}catch(error){
      if(error instanceof BodyTimeoutError)return contactJSON({message:'A transmissão demorou demasiado. Os campos foram mantidos; verifique a ligação e tente novamente.'},408);
      return contactJSON({message:error instanceof RangeError?'O pedido excede o tamanho permitido.':'Não foi possível ler o pedido.'},error instanceof RangeError?413:400);
    }
    const {data,errors}=validateSubmission(body);
    if(Object.keys(errors).length)return contactJSON({message:'Verifique os campos assinalados.',errors},422);
    if(data.website)return contactJSON({message:'Não foi possível validar o pedido. Reabra o formulário.'},400);
    const ticket=await parseContactToken(data.token,env);
    if(!ticket)return contactJSON({message:'A sessão do formulário precisa de ser renovada. Os campos foram mantidos. Aguarde a renovação e confirme novamente o envio.',refreshToken:true},403);
    // Pedidos bloqueados ou inválidos nunca consomem o orçamento dos restantes visitantes.
    const edge=await env.FORM_EDGE_RATE.limit({key:'time-saver-contact'});
    if(!edge.success)return rateLimited();
    // O mesmo ticket/chave produz sempre a mesma referência, data e corpo, sem registo local.
    const fingerprint=await keyedHash(env.SECURITY_HMAC_KEY,'contact-send:'+ticket.nonce+':'+key.toLowerCase());
    const reference='TS-'+fingerprint.slice(0,20).toUpperCase();
    const text=contactEmail(data,reference,ticket.created);
    // A escrita do CRM precede o Resend; não confirmar sem registo.
    let quoteEntry=null;
    if(env.QUOTE_CRM_ENABLED==='true'){
      try { quoteEntry=await storeQuote(env,data,reference,Date.now()); }
      catch { return contactJSON({
        message:'Não foi possível registar o pedido neste momento. Os campos foram mantidos; tente novamente.'
      },503); }
    }
    const response=await transport('https://api.resend.com/emails',{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(12_000),
      headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'time-saver-contact/'+fingerprint},
      body:JSON.stringify({from:CONTACT_FROM,to:[CONTACT_TO],reply_to:data.email,
        subject:'Time Saver — Novo pedido de orçamento',text})
    });
    const result=await response.json().catch(()=>null);
    if(response.ok&&typeof result?.id==='string'&&result.id.length>0){
      if(quoteEntry)await markQuoteReceived(quoteEntry,result.id).catch(()=>{});
      return contactJSON({accepted:true,reference});
    }
    if(response.status===409)return contactJSON({message:'O pedido está a ser processado ou foi alterado. Aguarde um momento e tente novamente com os mesmos dados.',
      renewKey:result?.name==='invalid_idempotent_request'},409,{'Retry-After':'3'});
    return contactJSON({message:'Não foi possível confirmar o envio. Os campos foram mantidos; aguarde um momento e tente novamente.'},502);
  }catch{return contactJSON({message:'O serviço está temporariamente indisponível. Os campos foram mantidos; tente novamente mais tarde.'},503);}
}
