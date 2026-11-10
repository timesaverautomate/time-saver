import { ASSETS } from './assets.generated.mjs';
import { validateSubmission, readBoundedJSON } from './validation.mjs';
import { securityHeaders, apiJSON, originAllowed, keyedHash, issueFormToken, validFormToken, corsResponse, corsPreflight } from './security.mjs';
import { cleanupSecurity, takeRate, claimSubmission, markSubmission } from './store.mjs';
import { deliveryConfigured, sendQuote } from './mail.mjs';

async function sourceKey(request, env) {
  // Só confiar no cabeçalho inserido pelo edge Cloudflare, nunca em X-Forwarded-For.
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) throw new Error('missing_edge_ip');
  return keyedHash(env.SECURITY_HMAC_KEY, `origin:${ip}`);
}
async function applyLimits(request, env, kind) {
  const now = Date.now();
  const source = await sourceKey(request, env);
  const minute = Math.floor(now / 60_000);
  const quarter = Math.floor(now / 900_000);
  const hour = Math.floor(now / 3_600_000);
  await cleanupSecurity(env.DB, now);
  if (kind === 'token') return (await takeRate(env.DB, `token:${source}:${minute}`,30,(minute+1)*60_000))
    && (await takeRate(env.DB, `tokens-global:${minute}`,200,(minute+1)*60_000));
  return (await takeRate(env.DB, `source:${source}:${quarter}`,8,(quarter+1)*900_000))
    && (await takeRate(env.DB, `global:${minute}`,30,(minute+1)*60_000))
    && (await takeRate(env.DB, `hour:${hour}`,150,(hour+1)*3_600_000));
}
const pendingText = 'O formulário ainda não está disponível. O envio de pedidos está temporariamente desativado.';
async function handleAPI(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/api/form-status' && request.method === 'GET') {
    if ((request.headers.has('Origin') && !originAllowed(request,env))
      || (!request.headers.has('Origin') && new URL(request.url).origin !== env.PUBLIC_ORIGIN)) {
      return apiJSON({available:false,message:'Origem não permitida.'},403,env);
    }
    if (!deliveryConfigured(env)) return apiJSON({ available:false, message:pendingText },200,env);
    try {
      if (!await applyLimits(request,env,'token')) return apiJSON({ available:false, message:'Foram feitas demasiadas tentativas. Aguarde um minuto.' },429,env,{'Retry-After':'60'});
      return apiJSON({ available:true, token:await issueFormToken(env) },200,env);
    } catch { return apiJSON({ available:false, message:pendingText },503,env); }
  }
  if (path !== '/api/quote') return apiJSON({ message:'Página não encontrada.' },404,env);
  if (request.method !== 'POST') return apiJSON({ message:'Método não permitido.' },405,env,{'Allow':'POST'});
  if (!deliveryConfigured(env)) return apiJSON({ message:pendingText },503,env);
  if (!originAllowed(request,env)) return apiJSON({ message:'Não foi possível validar a origem do pedido. Reabra o site e tente novamente.' },403,env);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return apiJSON({ message:'Formato de pedido inválido.' },415,env);
  const key = request.headers.get('Idempotency-Key');
  if (!key || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)) return apiJSON({ message:'Recarregue o formulário e tente novamente.' },400,env);
  try {
    if (!await applyLimits(request,env,'quote')) return apiJSON({ message:'Foram feitas demasiadas tentativas. Aguarde alguns minutos antes de voltar a tentar.' },429,env,{'Retry-After':'900'});
    let body;
    try { body = await readBoundedJSON(request); }
    catch (error) { return apiJSON({ message:error instanceof RangeError ? 'O pedido excede o tamanho permitido.' : 'Não foi possível ler o pedido.' },error instanceof RangeError ? 413 : 400,env); }
    const { data,errors } = validateSubmission(body);
    if (Object.keys(errors).length) return apiJSON({ message:'Verifique os campos assinalados.', errors },422,env);
    if (data.website) return apiJSON({ message:'Não foi possível validar o pedido. Recarregue a página e tente novamente.' },400,env);
    if (!await validFormToken(data.token,env)) return apiJSON({ message:'O formulário expirou ou foi enviado demasiado depressa. Aguarde um momento e tente novamente.', refreshToken:true },403,env);
    const canonical = JSON.stringify(['name','email','description','company','service','tools','deadline','budget'].map(field=>[field,data[field]]));
    const fingerprint = await keyedHash(env.SECURITY_HMAC_KEY,`payload:${canonical}`);
    const keyHash = await keyedHash(env.SECURITY_HMAC_KEY,`idempotency:${key}`);
    const claim = await claimSubmission(env.DB,keyHash,fingerprint);
    if (claim.conflict) return apiJSON({ message:'O formulário foi alterado. Volte a tentar o envio.', renewKey:true },409,env);
    if (!claim.owned) {
      if (claim.record.state === 'accepted') return apiJSON({ accepted:true, reference:claim.record.reference, duplicate:true },200,env);
      return apiJSON({ message:'Este pedido já está a ser processado. Aguarde um momento e volte a tentar.' },409,env,{'Retry-After':'30'});
    }
    try {
      const sent = await sendQuote(env,data,claim.record);
      if (!sent.accepted) {
        await markSubmission(env.DB,claim.record.key,'retry');
        return apiJSON({ message:'Não foi possível confirmar o envio. Os campos foram mantidos. Aguarde um momento e tente novamente.' },502,env);
      }
      await markSubmission(env.DB,claim.record.key,'accepted');
      return apiJSON({ accepted:true, reference:claim.record.reference },200,env);
    } catch {
      // Reutilizar a mesma referência e corpo após timeout: Resend aplica idempotência.
      await markSubmission(env.DB,claim.record.key,'retry').catch(()=>{});
      return apiJSON({ message:'Não foi possível confirmar o envio. Aguarde um momento e tente novamente com os mesmos dados.' },502,env);
    }
  } catch { return apiJSON({ message:'O serviço está temporariamente indisponível. Os campos foram mantidos; tente novamente mais tarde.' },503,env); }
}
async function workerFetch(request, env = {}) {
  try {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return corsPreflight(request,env);
      return corsResponse(request,await handleAPI(request,env),env);
    }
    if (env.API_ONLY === 'true') return apiJSON({message:'Página não encontrada.'},404,env);
    if (!['GET','HEAD'].includes(request.method)) return new Response('Método não permitido.',{status:405,headers:securityHeaders(env)});
    if (url.pathname === '/robots.txt') {
      return new Response(`User-agent: *\n${env.LEGAL_READY === 'true' ? 'Allow: /' : 'Disallow: /'}\n`,{headers:{...Object.fromEntries(securityHeaders(env)),'Content-Type':'text/plain; charset=utf-8'}});
    }
    let path = url.pathname.replace(/\/$/,'') || '/';
    if (path === '/index.html') path = '/';
    const asset = ASSETS[path] || ASSETS['/404'];
    const headers = securityHeaders(env);
    headers.set('Content-Type',asset.type);
    const body = request.method === 'HEAD' ? null : asset.encoding === 'base64'
      ? Uint8Array.from(atob(asset.body),character=>character.charCodeAt(0)) : asset.body;
    return new Response(body,{status:ASSETS[path] ? 200 : 404,headers});
  } catch { return new Response('Serviço temporariamente indisponível.',{status:503,headers:securityHeaders(env)}); }
}
export default {
  fetch:workerFetch,
  async scheduled(_event,env,ctx) { ctx.waitUntil(cleanupSecurity(env.DB)); }
};
