// Ficheiros no GitHub Pages; este Worker protege apenas os dois hosts públicos.
import { handleContact,contactConfigured } from './contact.mjs';
const DOMAIN='timesaverautomate.com';
const ORIGIN='https://timesaverautomate.github.io';
const PREFIX='/time-saver/';
const ROUTES=new Set(['','index.html','styles.css','app.js','logo.svg','favicon.svg',
  'partilha.png','partilha.svg','404.html','robots.txt','sitemap.xml','privacidade/','aviso-legal/','cookies/',
  'en/','en/privacy/','en/legal/','en/cookies/']);
const PAGE_PATHS=['/privacidade','/aviso-legal','/cookies','/en','/en/privacy','/en/legal','/en/cookies'];
const POLICY="default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'; upgrade-insecure-requests";

function protectedHeaders(env, upstream, indexable=env.SEARCH_INDEXING_ENABLED==='true') {
  const headers=new Headers(upstream || {});
  for(const name of ['Set-Cookie','X-Powered-By','Access-Control-Allow-Origin',
    'Access-Control-Allow-Credentials','Report-To','Reporting-Endpoints','NEL']) headers.delete(name);
  const policy=contactConfigured(env)?POLICY.replace("connect-src 'none'","connect-src 'self'").replace("form-action 'none'","form-action 'self'"):POLICY;
  headers.set('Content-Security-Policy',policy);
  headers.set('X-Frame-Options','DENY');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()');
  headers.set('Cross-Origin-Opener-Policy','same-origin');
  headers.set('Cross-Origin-Resource-Policy','same-origin');
  headers.set('X-Robots-Tag',indexable?'index, follow':'noindex, nofollow');
  headers.set('X-Time-Saver-Edge','1');
  if(env.HSTS_ENABLED==='true') headers.set('Strict-Transport-Security','max-age=31536000');
  else headers.delete('Strict-Transport-Security');
  return headers;
}
function message(text,status,env,extra={}) {
  const headers=protectedHeaders(env,undefined,status<400&&env.SEARCH_INDEXING_ENABLED==='true');
  headers.set('Content-Type','text/plain; charset=utf-8');
  headers.set('Cache-Control','no-store');
  for(const [key,value] of Object.entries(extra)) headers.set(key,value);
  return new Response(text,{status,headers});
}

const EN_ERRORS=new Map([
  ['Página não encontrada.','Page not found.'],
  ['Utilize um navegador com TLS 1.2 ou superior.','Use a browser with TLS 1.2 or later.'],
  ['Origem não permitida.','This origin is not allowed.'],
  ['Método não permitido.','This request method is not allowed.'],
  ['O site está temporariamente indisponível. Tente novamente mais tarde.','The website is temporarily unavailable. Please try again later.'],
  ['O site está em atualização. Tente novamente mais tarde.','The website is being updated. Please try again later.']
]);
export async function proxyFetch(request,env={},fetcher=globalThis.fetch) {
  let english=false;
  const respond=(text,status,extra={})=>message(english?(EN_ERRORS.get(text)||text):text,status,env,extra);
  try {
    const url=new URL(request.url);
    english=url.pathname==='/en'||url.pathname.startsWith('/en/');
    if(![DOMAIN,'www.'+DOMAIN].includes(url.hostname)) return respond('Página não encontrada.',404);
    const tls=request.cf?.tlsVersion;
    if(tls && /^TLSv?1(?:\.0|\.1)?$/i.test(tls)) return respond('Utilize um navegador com TLS 1.2 ou superior.',426);
    if(url.pathname.startsWith('/api/')){
      if(url.protocol!=='https:'||url.hostname!==DOMAIN||url.search)return respond('Origem não permitida.',403);
      const response=await handleContact(request,env,fetcher);
      return new Response(response.body,{status:response.status,headers:protectedHeaders(env,response.headers,false)});
    }
    if(!['GET','HEAD'].includes(request.method)) return respond('Método não permitido.',405,{'Allow':'GET, HEAD'});
    let pathname=url.pathname;
    if(pathname==='/time-saver' || pathname==='/time-saver/') pathname='/';
    else if(pathname.startsWith(PREFIX)) pathname='/'+pathname.slice(PREFIX.length);
    if(pathname==='/index.html') pathname='/';
    for(const page of PAGE_PATHS){if(pathname===page+'/index.html')pathname=page+'/';}
    if(PAGE_PATHS.includes(pathname)) pathname+='/';
    if(url.protocol!=='https:' || url.hostname!==DOMAIN || url.search || pathname!==url.pathname) {
      return respond('',308,{'Location':'https://'+DOMAIN+pathname});
    }
    const route=pathname.slice(1);
    const known=ROUTES.has(route);
    if(!known) return respond('Página não encontrada.',404);
    if(route==='robots.txt') {
      const headers=protectedHeaders(env);headers.set('Content-Type','text/plain; charset=utf-8');
      headers.set('Cache-Control','public, max-age=60');
      const rules=env.SEARCH_INDEXING_ENABLED==='true'
        ?'User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://'+DOMAIN+'/sitemap.xml\n'
        :'User-agent: *\nDisallow: /\n';
      return new Response(request.method==='HEAD'?null:rules,{headers});
    }
    // Não reencaminhar cookies, autorização, origem, IPs ou parâmetros fornecidos no pedido.
    const upstream=await fetcher(ORIGIN+PREFIX+route,{
      // No runtime Workers, manual é o modo que permite recusar redirecionamentos.
      method:'GET',redirect:'manual',signal:AbortSignal.timeout(15_000),
      headers:{Accept:'text/html, text/css, application/javascript, image/*;q=0.8, */*;q=0.5'},
      cf:{cacheEverything:true,cacheTtlByStatus:{'200-299':60,'404':15,'500-599':0}}
    });
    if(!upstream.ok) return respond('O site está temporariamente indisponível. Tente novamente mais tarde.',503);
    const indexable=route!=='404.html'&&env.SEARCH_INDEXING_ENABLED==='true';
    const headers=protectedHeaders(env,upstream.headers,indexable);
    headers.set('Cache-Control','public, max-age=60');
    let body=upstream.body;
    if(upstream.headers.get('Content-Type')?.includes('text/html')) {
      headers.set('Content-Language',english?'en':'pt-PT');
      let html=await upstream.text();
      const knownContact=/name="time-saver-form-definition" content="direct-email-v1"/.test(html);
      const hasFields=/<(?:form|input|textarea|select)\b/i.test(html);
      if(!/name="time-saver-form-mode" content="disabled"/.test(html) || hasFields&&!knownContact) {
        return respond('O site está em atualização. Tente novamente mais tarde.',503);
      }
      if(knownContact&&contactConfigured(env))html=html.replace('name="time-saver-form-mode" content="disabled"','name="time-saver-form-mode" content="backend"');
      if(indexable)html=html.replace(/(<meta\s+name=["']robots["']\s+content=["'])noindex,\s*nofollow(["'][^>]*>)/gi,'$1index,follow$2');
      html=html.replaceAll(ORIGIN+PREFIX,'https://'+DOMAIN+'/')
        .replaceAll('="'+PREFIX,'="/');
      for(const name of ['Content-Length','Content-Encoding','ETag','Last-Modified']) headers.delete(name);
      body=html;
    }
    return new Response(request.method==='HEAD'?null:body,{status:upstream.status,headers});
  } catch {
    return respond('O site está temporariamente indisponível. Tente novamente mais tarde.',503);
  }
}
export default {fetch(request,env){return proxyFetch(request,env);}};
