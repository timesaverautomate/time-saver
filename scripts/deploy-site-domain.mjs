import { readFile } from 'node:fs/promises';

const DOMAIN='timesaverautomate.com';
const HOSTS=[DOMAIN,'www.'+DOMAIN];
const WORKER='time-saver-edge';
const PROJECT='1452563434';
const ID=/^[a-f0-9]{32}$/i;
class DomainError extends Error {
  constructor(code,httpStatus,operation){super(code);Object.assign(this,{code,httpStatus,operation});}
}
function requireDomain(value,code){if(!value)throw new DomainError(code);}

export async function deploySiteDomain({env,source,fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=24}) {
  const attached=[];let installed=false;
  try {
    requireDomain(env.GITHUB_REPOSITORY_ID===PROJECT && env.GITHUB_REPOSITORY==='timesaverautomate/time-saver'
      && env.GITHUB_REF==='refs/heads/main','unauthorised_repository');
    requireDomain(typeof env.CLOUDFLARE_API_TOKEN==='string' && env.CLOUDFLARE_API_TOKEN.length>=20
      && env.CLOUDFLARE_API_TOKEN.length<=512 && !/[\s\x00-\x1f\x7f]/.test(env.CLOUDFLARE_API_TOKEN),'missing_cloudflare_token');
    requireDomain(typeof source==='string' && source.includes('timesaverautomate.github.io'),'invalid_proxy_source');
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
    requireDomain(html.includes('name="time-saver-form-mode" content="disabled"')
      && !/<(?:form|input|textarea|select)\b/i.test(html),'origin_is_not_public_preview');
    let hsts=settings?.bindings?.some(b=>b.name==='HSTS_ENABLED' && b.type==='plain_text' && b.text==='true') || false;
    async function upload() {
      const form=new FormData();
      form.set('metadata',new Blob([JSON.stringify({main_module:'proxy.mjs',compatibility_date:'2026-11-01',
        observability:{enabled:false},bindings:[
          {type:'plain_text',name:'TIME_SAVER_REPOSITORY_ID',text:PROJECT},
          {type:'plain_text',name:'HSTS_ENABLED',text:String(hsts)}
        ]})],{type:'application/json'}),'metadata.json');
      form.set('proxy.mjs',new Blob([source],{type:'application/javascript+module'}),'proxy.mjs');
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
        const root=await fetcher('https://'+DOMAIN+'/',{redirect:'manual',signal:AbortSignal.timeout(15_000)});
        const body=await root.text();
        if(root.status!==200 || root.headers.get('X-Time-Saver-Edge')!=='1'
          || !root.headers.get('Content-Security-Policy')?.includes("frame-ancestors 'none'")
          || /<(?:form|input|textarea|select)\b/i.test(body) || body.includes('="/time-saver/')
          || (expectHsts && root.headers.get('Strict-Transport-Security')!=='max-age=31536000'))return false;
        const www=await fetcher('https://www.'+DOMAIN+'/',{redirect:'manual',signal:AbortSignal.timeout(15_000)});
        return www.status===308 && www.headers.get('Location')==='https://'+DOMAIN+'/';
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
    return {configured:true,verified,installed,attached,code:verified?'domain_and_security_verified':'hsts_verification_pending'};
  }catch(error){return {configured:attached.length>0,verified:false,installed,attached,
    code:error instanceof DomainError?error.code:'domain_setup_failed',
    ...(error instanceof DomainError && error.httpStatus ? {httpStatus:error.httpStatus,operation:error.operation}:{} )};}
}

export async function readProxySource(){return readFile(new URL('../src/site-proxy.mjs',import.meta.url),'utf8');}
