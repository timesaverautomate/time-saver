import {readFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const WORKER='timesaver-resend-webhook';
const PROJECT='1452563434';
const REPOSITORY='timesaverautomate/time-saver';
const CRM_ID='1VYEBWJb_9cYGbO8nZa3d_qh1rLUH-H3xf-w4CnOLMS4';
const ID=/^[a-f0-9]{32}$/i;
const MAX_SOURCE=2_000_000;
const sha=value=>createHash('sha256').update(value).digest('hex');
class DeployError extends Error {
  constructor(code,httpStatus,operation){super(code);Object.assign(this,{code,httpStatus,operation});}
}
function requireValue(value,code){if(!value)throw new DeployError(code);}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function bindings(settings){
  const value=settings?.bindings;
  requireValue(Array.isArray(value)&&value.length>0&&value.length<=100,'worker_bindings_unverified');
  requireValue(value.every(b=>b&&typeof b==='object'&&!Array.isArray(b)
    &&typeof b.type==='string'&&/^[a-z_]+$/.test(b.type)
    &&typeof b.name==='string'&&/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(b.name))
    &&new Set(value.map(b=>b.name)).size===value.length,'worker_bindings_unverified');
  const coordinator=value.find(b=>b.name==='CRM_COORDINATOR');
  requireValue(coordinator?.type==='durable_object_namespace'
    &&coordinator.class_name==='CrmEventCoordinator'&&ID.test(coordinator.namespace_id||'')
    &&(!coordinator.script_name||coordinator.script_name===WORKER)
    &&(!coordinator.environment||coordinator.environment==='production')
    &&!coordinator.dispatch_namespace,'coordinator_binding_unverified');
  for(const name of ['RESEND_WEBHOOK_SECRET','GOOGLE_SERVICE_ACCOUNT_JSON']){
    requireValue(value.some(b=>b.name===name&&b.type==='secret_text'),'required_secret_binding_missing');
  }
  return value.slice().sort((a,b)=>a.name.localeCompare(b.name));
}
function ownedSource(source){
  return typeof source==='string'&&source.length>100&&source.length<=MAX_SOURCE
    &&/\bverifySvix(?:Detailed)?\b/.test(source)
    &&(/export\s+class\s+CrmEventCoordinator\b/.test(source)
      ||/export\s*\{[^}]*\bCrmEventCoordinator\b[^}]*\}/s.test(source))
    &&source.includes(CRM_ID)&&source.includes('/webhooks/resend')
    &&(/export\s+default\b/.test(source)||/export\s*\{[^}]*\bas\s+default\b[^}]*\}/s.test(source))
    &&!/^\s*import\b/m.test(source);
}
async function boundedBody(response){
  const length=response.headers.get('Content-Length');
  requireValue(!length||/^\d+$/.test(length)&&Number(length)<=MAX_SOURCE,'worker_source_unverified');
  const reader=response.body?.getReader();requireValue(reader,'worker_source_unverified');
  const chunks=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      requireValue(size<=MAX_SOURCE,'worker_source_unverified');chunks.push(value);}
  }catch(error){try{void reader.cancel().catch(()=>{});}catch{}throw error;}
  finally{try{reader.releaseLock();}catch{}}
  const bytes=new Uint8Array(size);let offset=0;
  for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  return bytes;
}
async function sourceText(response){
  const bytes=await boundedBody(response),type=response.headers.get('Content-Type')||'';
  if(/^multipart\/form-data\b/i.test(type)){
    let parts;try{parts=await new Response(bytes,{headers:{'Content-Type':type}}).formData();}
    catch{throw new DeployError('worker_source_unverified');}
    const modules=[];
    for(const [name,part]of parts){
      if(name==='metadata')continue;
      requireValue(/^[A-Za-z0-9._-]+\.m?js$/.test(name),'worker_source_unverified');
      modules.push(typeof part==='string'?part:await part.text());
    }
    requireValue(modules.length===1,'worker_source_unverified');return modules[0];
  }
  requireValue(/^(?:application\/(?:javascript(?:\+module)?|x-javascript)|text\/(?:javascript|plain))(?:;|$)/i.test(type),
    'worker_source_unverified');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{throw new DeployError('worker_source_unverified');}
}
// API documentation: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/
// Every existing binding is inherited by name with bindings_inherit=strict. This
// documented variant preserves secrets, namespace IDs and binding types without
// reconstructing or exposing provider-specific values. No migrations are sent.
export async function deployResendWebhook({env,source,fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=6}={}){
  let installed=false;
  try{
    requireValue(env?.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY_ID===PROJECT
      &&env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_REF==='refs/heads/main'
      &&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&/^\d+$/.test(env.GITHUB_RUN_ID||'')
      &&['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)
      &&env.GITHUB_WORKFLOW_REF===REPOSITORY+'/.github/workflows/webhook-security.yml@refs/heads/main',
      'unauthorised_workflow');
    requireValue(typeof env.CLOUDFLARE_API_TOKEN==='string'&&env.CLOUDFLARE_API_TOKEN.length>=20
      &&env.CLOUDFLARE_API_TOKEN.length<=512&&!/[\s\x00-\x1f\x7f]/.test(env.CLOUDFLARE_API_TOKEN),
      'missing_cloudflare_token');
    requireValue(ownedSource(source),'invalid_local_source');
    requireValue(Number.isInteger(attempts)&&attempts>=1&&attempts<=12,'invalid_attempts');
    async function cf(path,{method='GET',body,operation='cloudflare_read',raw=false}={}){
      const headers={Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN};
      if(body!==undefined&&!(body instanceof FormData))headers['Content-Type']='application/json';
      let response;
      try{response=await fetcher('https://api.cloudflare.com/client/v4'+path,{
        method,headers,redirect:'error',signal:AbortSignal.timeout(20_000),
        ...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});}
      catch{throw new DeployError('cloudflare_unreachable',undefined,operation);}
      if(response.status===404)throw new DeployError('existing_worker_not_found',404,operation);
      if(!response.ok)throw new DeployError('cloudflare_request_rejected',response.status,operation);
      if(raw)return response;
      let result;try{result=await response.json();}catch{throw new DeployError('invalid_cloudflare_response',undefined,operation);}
      requireValue(result?.success===true&&result.result!==undefined,'invalid_cloudflare_response');return result.result;
    }
    let account=env.CLOUDFLARE_ACCOUNT_ID||'';
    if(!account){
      const accounts=await cf('/accounts?per_page=50',{operation:'account_discovery'});
      requireValue(Array.isArray(accounts)&&accounts.length===1,'account_selection_required');account=accounts[0]?.id;
    }
    requireValue(ID.test(account),'invalid_account_id');
    const base='/accounts/'+account,worker=base+'/workers/scripts/'+WORKER;
    const settings=await cf(worker+'/settings',{operation:'worker_settings'});
    const originalBindings=bindings(settings);
    requireValue(/^\d{4}-\d{2}-\d{2}$/.test(settings.compatibility_date||''),'worker_settings_unverified');
    requireValue(settings.compatibility_flags===undefined||Array.isArray(settings.compatibility_flags)
      &&settings.compatibility_flags.every(v=>typeof v==='string'),'worker_settings_unverified');
    const previousSource=await sourceText(await cf(worker+'/content/v2',{raw:true,operation:'worker_source'}));
    requireValue(ownedSource(previousSource),'worker_ownership_unverified');
    const subdomain=await cf(worker+'/subdomain',{operation:'worker_subdomain'});
    requireValue(typeof subdomain?.enabled==='boolean'
      &&(subdomain.previews_enabled===undefined||typeof subdomain.previews_enabled==='boolean'),'worker_subdomain_unverified');
    let publicOrigin;
    if(subdomain.enabled){
      const accountDomain=await cf(base+'/workers/subdomain',{operation:'account_subdomain'});
      requireValue(typeof accountDomain?.subdomain==='string'
        &&/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(accountDomain.subdomain),'worker_subdomain_unverified');
      publicOrigin='https://'+WORKER+'.'+accountDomain.subdomain+'.workers.dev';
    }else{
      const domains=await cf(base+'/workers/domains',{operation:'worker_domains'});
      requireValue(Array.isArray(domains)&&domains.length<100,'worker_domains_unverified');
      const matches=domains.filter(d=>d.service===WORKER&&typeof d.hostname==='string'
        &&/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*timesaverautomate\.com$/.test(d.hostname));
      requireValue(matches.length===1,'public_verification_unavailable');publicOrigin='https://'+matches[0].hostname;
    }
    // A concurrent operator must not be overwritten based on an obsolete read.
    const recent=await cf(worker+'/settings',{operation:'worker_settings_recheck'});
    const recentSource=await sourceText(await cf(worker+'/content/v2',{raw:true,operation:'worker_source_recheck'}));
    requireValue(same(settings,recent)&&sha(previousSource)===sha(recentSource),'worker_changed_during_preflight');
    const form=new FormData();
    const metadata={main_module:'worker.mjs',compatibility_date:settings.compatibility_date,
      bindings:originalBindings.map(b=>({name:b.name,type:'inherit'})),
      observability:{enabled:false}};
    if(originalBindings.some(b=>b.type==='assets'))metadata.keep_assets=true;
    for(const key of ['compatibility_flags','limits','placement','tags','tail_consumers','usage_model','logpush']){
      if(settings[key]!==undefined)metadata[key]=structuredClone(settings[key]);
    }
    form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}),'metadata.json');
    form.set('worker.mjs',new Blob([source],{type:'application/javascript+module'}),'worker.mjs');
    await cf(worker+'?bindings_inherit=strict',{method:'PUT',body:form,operation:'worker_upload'});installed=true;
    const stored=await cf(worker+'/settings',{operation:'verify_settings'});
    requireValue(same(originalBindings,bindings(stored)),'worker_bindings_changed');
    requireValue(stored.observability?.enabled===false,'observability_not_disabled');
    for(const key of ['compatibility_date','compatibility_flags','limits','placement','tags','tail_consumers','usage_model','logpush']){
      if(settings[key]!==undefined)requireValue(same(settings[key],stored[key]),'worker_settings_changed');
    }
    const currentSubdomain=await cf(worker+'/subdomain',{operation:'verify_subdomain'});
    requireValue(same(subdomain,currentSubdomain),'worker_subdomain_changed');
    const published=await sourceText(await cf(worker+'/content/v2',{raw:true,operation:'verify_source'}));
    requireValue(ownedSource(published)&&sha(published)===sha(source),'worker_source_unverified');
    let healthy=false;
    for(let i=0;i<attempts;i++){
      try{
        const result=await fetcher(publicOrigin+'/health',{
          method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15_000)});
        const data=await result.json();
        healthy=result.status===200&&result.headers.get('Cache-Control')==='no-store'
          &&result.headers.get('X-Content-Type-Options')==='nosniff'
          &&data?.status==='ok'&&data.sending_enabled===false&&typeof data.crm_writes_enabled==='boolean'
          &&Object.keys(data).sort().join(',')==='crm_writes_enabled,sending_enabled,status';
      }catch{healthy=false;}
      if(healthy)break;if(i+1<attempts)await sleep(2000);
    }
    requireValue(healthy,'public_health_unverified');
    let unsigned;
    try{unsigned=await fetcher(publicOrigin+'/webhooks/resend',{
      method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15_000),
      headers:{'Content-Type':'application/json'},body:'{}'});}catch{throw new DeployError('unsigned_request_unverified');}
    let rejected;try{rejected=await unsigned.json();}catch{throw new DeployError('unsigned_request_unverified');}
    requireValue(unsigned.status===401&&unsigned.headers.get('Cache-Control')==='no-store'
      &&rejected?.error==='unauthorized'&&Object.keys(rejected).length===1,'unsigned_request_unverified');
    return {installed,verified:true,code:'webhook_security_verified',sourceSha256:sha(source),
      bindingsRetained:originalBindings.length,workersDevStatePreserved:true,unauthenticatedEventRejected:true};
  }catch(error){return {installed,verified:false,code:error instanceof DeployError?error.code:'webhook_deployment_failed',
    ...(error instanceof DeployError&&error.httpStatus?{httpStatus:error.httpStatus,operation:error.operation}:{} )};}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let result;
  try{result=await deployResendWebhook({env:process.env,
    source:await readFile(new URL('../workers/resend-webhook.js',import.meta.url),'utf8')});}
  catch{result={installed:false,verified:false,code:'local_source_unavailable'};}
  console.log(JSON.stringify(result,null,2));
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
    '## Segurança do webhook Time Saver\n\nResultado: '+result.code+'\n\n'
    +'Código verificado por SHA-256 e bindings existentes preservados: '+String(result.verified)+'\n\n'
    +'Sem migrações, alterações de flags de escrita, novos serviços ou eventos autenticados.\n');
  if(!result.verified)process.exitCode=1;
}
