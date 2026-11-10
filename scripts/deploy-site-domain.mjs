import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { hardenZoneTLS } from './zone-security.mjs';

const DOMAIN='timesaverautomate.com';
const HOSTS=[DOMAIN,'www.'+DOMAIN];
const WORKER='time-saver-edge';
const PROJECT='1452563434';
const ID=/^[a-f0-9]{32}$/i;
class DomainError extends Error {
  constructor(code,httpStatus,operation){super(code);Object.assign(this,{code,httpStatus,operation});}
}
function requireDomain(value,code){if(!value)throw new DomainError(code);}

export async function deploySiteDomain({env,source,modules={},fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=24,mask=()=>{}}) {
  const attached=[];let installed=false;
  try {
    requireDomain(env.GITHUB_REPOSITORY_ID===PROJECT && env.GITHUB_REPOSITORY==='timesaverautomate/time-saver'
      && env.GITHUB_REF==='refs/heads/main','unauthorised_repository');
    requireDomain(typeof env.CLOUDFLARE_API_TOKEN==='string' && env.CLOUDFLARE_API_TOKEN.length>=20
      && env.CLOUDFLARE_API_TOKEN.length<=512 && !/[\s\x00-\x1f\x7f]/.test(env.CLOUDFLARE_API_TOKEN),'missing_cloudflare_token');
    requireDomain(typeof source==='string' && source.includes('timesaverautomate.github.io'),'invalid_proxy_source');
    const formRequested=env.FORM_ENABLED==='true';
    if(formRequested)requireDomain(/^re_[A-Za-z0-9_-]{8,256}$/.test(env.RESEND_API_KEY||''),'missing_resend_key');
    async function cf(endpoint,{method='GET',body,notFound=false,operation='cloudflare_request'}={}) {
      const headers={Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN};
      if(body!==undefined && !(body instanceof FormData)) headers['Content-Type']='application/json';
      let response;
      try {response=await fetcher('https://api.cloudflare.com/client/v4'+endpoint,{
        method,headers,redirect:'error',signal:AbortSignal.timeout(20_000),
        ...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})
      });}catch{throw new DomainError('cloudflare_unreachable',undefined,operation);}
      if(notFound && response.status===404)return null;
      if(!response.ok)throw new DomainError('cloudflare_request_rejected',response.status,operation);
      const data=await response.json();requireDomain(data.success===true,'invalid_cloudflare_response');
      return data.result;
    }
    let account=env.CLOUDFLARE_ACCOUNT_ID || '';
    if(!account) {
      const accounts=await cf('/accounts?per_page=50',{operation:'account_discovery'});
      requireDomain(Array.isArray(accounts) && accounts.length===1,'account_selection_required');account=accounts[0].id;
    }
    requireDomain(ID.test(account),'invalid_account_id');
    const base='/accounts/'+account;
    const settings=await cf(base+'/workers/scripts/'+WORKER+'/settings',{notFound:true,operation:'worker_settings'});
    if(settings)requireDomain(settings.bindings?.some(b=>b.type==='plain_text'
      && b.name==='TIME_SAVER_REPOSITORY_ID' && b.text===PROJECT),'worker_ownership_unverified');
    const domains=await cf(base+'/workers/domains',{operation:'custom_domains_read'});
    requireDomain(Array.isArray(domains) && domains.length<100,'domain_inventory_invalid');
    for(const host of HOSTS) {
      const binding=domains.find(d=>d.hostname===host);
      requireDomain(!binding || binding.service===WORKER,'domain_belongs_to_another_worker');
      if(binding)continue;
      // Não substituir um serviço DNS existente. A API de domínio cria os seus próprios registos.
      for(const type of ['A','AAAA','CNAME']) {
        const result=await fetcher('https://dns.google/resolve?name='+host+'&type='+type,{
          redirect:'error',signal:AbortSignal.timeout(15_000)});
        requireDomain(result.ok,'dns_preflight_unavailable');
        const dns=await result.json();requireDomain([0,3].includes(dns.Status),'dns_preflight_unavailable');
        requireDomain(!dns.Answer?.length,'existing_dns_requires_review');
      }
    }
    // O domínio GitHub tem de continuar a ser uma origem independente para não criar ciclos.
    const origin=await fetcher('https://timesaverautomate.github.io/time-saver/',{
      redirect:'error',signal:AbortSignal.timeout(15_000)});
    requireDomain(origin.status===200,'github_origin_unavailable');
    const html=await origin.text();
    const definedContact=html.includes('name="time-saver-form-definition" content="direct-email-v1"');
    requireDomain(html.includes('name="time-saver-form-mode" content="disabled"')
      && (!/<(?:form|input|textarea|select)\b/i.test(html)||formRequested&&definedContact),'origin_is_not_public_preview');
    let hsts=settings?.bindings?.some(b=>b.name==='HSTS_ENABLED' && b.type==='plain_text' && b.text==='true') || false;
    let hmac='';
    if(formRequested&&!settings?.bindings?.some(b=>b.type==='secret_text'&&b.name==='SECURITY_HMAC_KEY')){
      hmac=randomBytes(32).toString('hex');mask(hmac);
    }
    async function upload() {
      const form=new FormData();
      const bindings=[{type:'plain_text',name:'TIME_SAVER_REPOSITORY_ID',text:PROJECT},
        {type:'plain_text',name:'HSTS_ENABLED',text:String(hsts)},
        {type:'plain_text',name:'FORM_ENABLED',text:String(formRequested)}];
      if(formRequested){
        bindings.push({type:'secret_text',name:'RESEND_API_KEY',text:env.RESEND_API_KEY});
        if(hmac)bindings.push({type:'secret_text',name:'SECURITY_HMAC_KEY',text:hmac});
        bindings.push(...[
          ['FORM_IP_RATE','1452563434',5],['FORM_EDGE_RATE','1452563435',30],['FORM_TOKEN_RATE','1452563436',30]
        ].map(([name,namespace_id,limit])=>({type:'ratelimit',name,namespace_id,simple:{limit,period:60}})));
      }
      form.set('metadata',new Blob([JSON.stringify({main_module:'proxy.mjs',compatibility_date:'2026-11-01',
        observability:{enabled:false},keep_bindings:['secret_text'],bindings})],{type:'application/json'}),'metadata.json');
      form.set('proxy.mjs',new Blob([source],{type:'application/javascript+module'}),'proxy.mjs');
      for(const [name,contents] of Object.entries(modules)){
        if(name==='proxy.mjs')continue;
        requireDomain(['contact.mjs','validation.mjs','security.mjs'].includes(name),'unexpected_worker_module');
        form.set(name,new Blob([contents],{type:'application/javascript+module'}),name);
      }
      await cf(base+'/workers/scripts/'+WORKER,{method:'PUT',body:form,operation:'worker_upload'});
      installed=true;
    }
    await upload();
    await cf(base+'/workers/scripts/'+WORKER+'/subdomain',{
      method:'POST',body:{enabled:false,previews_enabled:false},operation:'disable_workers_dev'});
    for(const hostname of HOSTS) {
      await cf(base+'/workers/domains',{method:'PUT',operation:'attach_custom_domain',body:{
        hostname,service:WORKER,zone_name:DOMAIN,enabled:true,previews_enabled:false
      }});
      attached.push(hostname);
    }
    async function verify(expectHsts) {
      try {
        function secure(response){
          const h=response.headers,policy=h.get('Content-Security-Policy')||'';
          return h.get('X-Time-Saver-Edge')==='1' && h.get('X-Frame-Options')==='DENY'
            && h.get('X-Content-Type-Options')==='nosniff' && h.get('Referrer-Policy')==='strict-origin-when-cross-origin'
            && h.get('Cross-Origin-Opener-Policy')==='same-origin' && h.get('Cross-Origin-Resource-Policy')==='same-origin'
            && !h.has('Set-Cookie') && !h.has('Access-Control-Allow-Origin') && !h.has('Access-Control-Allow-Credentials')
            && policy.includes("frame-ancestors 'none'") && policy.includes("object-src 'none'")
            && policy.includes("require-trusted-types-for 'script'")
            && (!expectHsts||h.get('Strict-Transport-Security')==='max-age=31536000');
        }
        const root=await fetcher('https://'+DOMAIN+'/',{redirect:'manual',signal:AbortSignal.timeout(15_000)});
        const body=await root.text();
        if(root.status!==200 || !secure(root)
          || (!formRequested&&/<(?:form|input|textarea|select)\b/i.test(body)) || body.includes('="/time-saver/'))return false;
        if(formRequested){
          const status=await fetcher('https://'+DOMAIN+'/api/form-status',{redirect:'manual',headers:{Origin:'https://'+DOMAIN},signal:AbortSignal.timeout(15_000)});
          const info=await status.json();
          if(!status.ok||!secure(status)||status.headers.get('Cache-Control')!=='no-store'
            || info.available!==true||info.version!=='direct-email-v1')return false;
        }
        const www=await fetcher('https://www.'+DOMAIN+'/',{redirect:'manual',signal:AbortSignal.timeout(15_000)});
        return www.status===308 && secure(www) && www.headers.get('Location')==='https://'+DOMAIN+'/';
      }catch{return false;}
    }
    let verified=false;
    for(let i=0;i<attempts;i++) {
      if(await verify(false)){verified=true;break;}
      if(i+1<attempts)await sleep(10_000);
    }
    if(!verified)return {configured:true,verified:false,installed,attached,code:'dns_or_certificate_pending'};
    if(!hsts){hsts=true;await upload();}
    verified=false;
    for(let i=0;i<6;i++) {
      if(await verify(true)){verified=true;break;}
      if(i<5)await sleep(2_000);
    }
    const zoneTLS=verified?await hardenZoneTLS({zoneId:domains.find(d=>d.hostname===DOMAIN)?.zone_id,cf}):{verified:false,changed:false,code:'https_not_verified'};
    return {configured:true,verified,installed,attached,contactApiConfigured:formRequested&&verified,zoneTLS,
      code:verified?(formRequested?'domain_and_contact_api_verified':'domain_and_security_verified'):'hsts_verification_pending'};
  }catch(error){return {configured:attached.length>0,verified:false,installed,attached,
    code:error instanceof DomainError?error.code:'domain_setup_failed',
    ...(error instanceof DomainError && error.httpStatus ? {httpStatus:error.httpStatus,operation:error.operation}:{} )};}
}

export async function readProxySource(){return readFile(new URL('../src/site-proxy.mjs',import.meta.url),'utf8');}
export async function readSiteModules(){
  const modules={};
  for(const [name,file] of [['proxy.mjs','site-proxy.mjs'],['contact.mjs','contact.mjs'],['validation.mjs','validation.mjs'],['security.mjs','security.mjs']]){
    modules[name]=await readFile(new URL('../src/'+file,import.meta.url),'utf8');
  }
  return modules;
}
