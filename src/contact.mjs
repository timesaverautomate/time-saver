import { validateSubmission,readBoundedJSON } from './validation.mjs';
import { keyedHash,sameDigest } from './security.mjs';

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
async function contactSource(request,env){
  const ip=request.headers.get('CF-Connecting-IP');
  if(!ip||ip.length>64||!/^[a-f0-9:.]+$/i.test(ip))throw Error('edge_ip_missing');
  const day=Math.floor(Date.now()/86400000);
  return keyedHash(env.SECURITY_HMAC_KEY,'contact-rate:'+day+':'+ip);
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
    if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return contactJSON({message:'Formato de pedido inválido.'},415);
    const key=request.headers.get('Idempotency-Key');
    if(!key||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key))return contactJSON({message:'Reabra o formulário e tente novamente.'},400);
    const local=await env.FORM_IP_RATE.limit({key:source});
    const edge=await env.FORM_EDGE_RATE.limit({key:'time-saver-contact'});
    if(!local.success||!edge.success)return contactJSON({message:'Foram feitas demasiadas tentativas. Aguarde um minuto antes de tentar novamente.'},429,{'Retry-After':'60'});
    let body;
    try{body=await readBoundedJSON(request);}catch(error){return contactJSON({message:error instanceof RangeError?'O pedido excede o tamanho permitido.':'Não foi possível ler o pedido.'},error instanceof RangeError?413:400);}
    const {data,errors}=validateSubmission(body);
    if(Object.keys(errors).length)return contactJSON({message:'Verifique os campos assinalados.',errors},422);
    if(data.website)return contactJSON({message:'Não foi possível validar o pedido. Reabra o formulário.'},400);
    const ticket=await parseContactToken(data.token,env);
    if(!ticket)return contactJSON({message:'O formulário expirou ou foi enviado demasiado depressa. Aguarde um momento; se o problema continuar, recarregue a página.'},403);
    // O mesmo ticket/chave produz sempre a mesma referência, data e corpo, sem registo local.
    const fingerprint=await keyedHash(env.SECURITY_HMAC_KEY,'contact-send:'+ticket.nonce+':'+key.toLowerCase());
    const reference='TS-'+fingerprint.slice(0,20).toUpperCase();
    const text=contactEmail(data,reference,ticket.created);
    const response=await transport('https://api.resend.com/emails',{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(12_000),
      headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'time-saver-contact/'+fingerprint},
      body:JSON.stringify({from:CONTACT_FROM,to:[CONTACT_TO],reply_to:data.email,
        subject:'Time Saver — Novo pedido de orçamento',text})
    });
    const result=await response.json().catch(()=>null);
    if(response.ok&&typeof result?.id==='string'&&result.id.length>0)return contactJSON({accepted:true,reference});
    if(response.status===409)return contactJSON({message:'O pedido está a ser processado ou foi alterado. Aguarde um momento e tente novamente com os mesmos dados.',
      renewKey:result?.name==='invalid_idempotent_request'},409,{'Retry-After':'3'});
    return contactJSON({message:'Não foi possível confirmar o envio. Os campos foram mantidos; aguarde um momento e tente novamente.'},502);
  }catch{return contactJSON({message:'O serviço está temporariamente indisponível. Os campos foram mantidos; tente novamente mais tarde.'},503);}
}
