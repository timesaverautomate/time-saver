export function securityHeaders(env, api = false) {
  const headers = new Headers({
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': api ? 'no-store' : 'public, max-age=0, must-revalidate',
    'X-Robots-Tag': env.LEGAL_READY === 'true' ? 'all' : 'noindex, nofollow'
  });
  if (env.HSTS_ENABLED === 'true') headers.set('Strict-Transport-Security', 'max-age=31536000');
  return headers;
}
export function apiJSON(value, status, env, extra = {}) {
  const headers = securityHeaders(env, true);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const [key,val] of Object.entries(extra)) headers.set(key,val);
  return new Response(JSON.stringify(value), { status, headers });
}
export function originAllowed(request, env) {
  const configured = env.PUBLIC_ORIGIN;
  if (!configured) return false;
  try {
    const origin = new URL(configured);
    const fetchSite = request.headers.get('Sec-Fetch-Site');
    const sameEndpointOrigin = new URL(request.url).origin === origin.origin;
    const allowedContext = !fetchSite || (sameEndpointOrigin
      ? fetchSite === 'same-origin'
      : ['same-site','cross-site'].includes(fetchSite));
    return configured === origin.origin && origin.protocol === 'https:'
      && request.headers.get('Origin') === origin.origin && allowedContext;
  } catch { return false; }
}
export function corsResponse(request,response,env) {
  const headers = new Headers(response.headers);
  headers.set('Vary',headers.has('Vary') ? headers.get('Vary')+', Origin' : 'Origin');
  if (originAllowed(request,env)) {
    headers.set('Access-Control-Allow-Origin',env.PUBLIC_ORIGIN);
    headers.set('Access-Control-Expose-Headers','Retry-After');
  }
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export function corsPreflight(request,env) {
  const path = new URL(request.url).pathname;
  const method = path === '/api/quote' ? 'POST' : path === '/api/form-status' ? 'GET' : null;
  const wantedMethod = request.headers.get('Access-Control-Request-Method');
  const wantedHeaders = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);
  if (!method || !originAllowed(request,env) || wantedMethod !== method
    || wantedHeaders.some(value=>!['content-type','idempotency-key'].includes(value))) {
    return apiJSON({message:'Origem, método ou cabeçalhos não permitidos.'},403,env);
  }
  const headers=securityHeaders(env,true);
  headers.set('Access-Control-Allow-Methods',method);
  headers.set('Access-Control-Allow-Headers','Content-Type, Idempotency-Key');
  headers.set('Access-Control-Max-Age','300');
  return corsResponse(request,new Response(null,{status:204,headers}),env);
}
export async function keyedHash(secret, text) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(text));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2,'0')).join('');
}
export function sameDigest(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function issueFormToken(env, now = Date.now()) {
  const value = `${now}.${crypto.randomUUID()}`;
  return `${value}.${await keyedHash(env.SECURITY_HMAC_KEY, `csrf:${value}`)}`;
}
export async function validFormToken(token, env, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3 || !/^\d{13}$/.test(parts[0]) || !/^[0-9a-f-]{36}$/.test(parts[1])) return false;
  const age = now - Number(parts[0]);
  return age >= 1500 && age <= 7_200_000 && sameDigest(parts[2], await keyedHash(env.SECURITY_HMAC_KEY, `csrf:${parts[0]}.${parts[1]}`));
}
