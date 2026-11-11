import {readFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// Independent verifier: every authenticated Cloudflare request is a fixed GET.
// This module cannot upload code, edit settings, migrate namespaces or toggle logs.
const WORKER='timesaver-resend-webhook';
const PROJECT='1452563434';
const REPOSITORY='timesaverautomate/time-saver';
const CRM_ID='1VYEBWJb_9cYGbO8nZa3d_qh1rLUH-H3xf-w4CnOLMS4';
const ID=/^[a-f0-9]{32}$/i;
const MAX_SOURCE=2_000_000;
const sha=value=>createHash('sha256').update(value).digest('hex');
class VerifyError extends Error {
  constructor(code,httpStatus,operation){super(code);Object.assign(this,{code,httpStatus,operation});}
}
function requireValue(value,code){if(!value)throw new VerifyError(code);}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value;
}
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
function observationFlags(settings){
  const state=value=>typeof value==='boolean'?value:'not_reported';
  return {enabled:state(settings?.observability?.enabled),
    logsEnabled:state(settings?.observability?.logs?.enabled),
    invocationLogs:state(settings?.observability?.logs?.invocation_logs)};
}
function observationDisabled(settings){
  return settings?.observability?.enabled===false
    &&settings.observability.logs?.enabled!==true
    &&settings.observability.logs?.invocation_logs!==true;
}
function sourceDifference(local,remote){
  const bytes=value=>Buffer.byteLength(value,'utf8');
  const lineEndings=value=>value.replace(/\r\n/g,'\n');
  const trimEnd=value=>value.replace(/[\t \r\n]+$/u,'');
  const withoutMap=value=>value.replace(/(?:\r?\n)?\/\/[#@]\s*sourceMappingURL=[^\r\n]*(?:\r?\n)?[\t ]*$/u,'');
  const withoutBom=value=>value.replace(/^\uFEFF/u,'');
  const markers=value=>{
    const compact=value.replace(/\s+/g,'');
    const start=value.search(/function\s+googleRequest\s*\(/);
    const next=start<0?-1:value.slice(start+1).search(/(?:export\s+)?(?:async\s+)?function\s+googleToken\s*\(/);
    const google=start<0?'':value.slice(start,next<0?start+1500:start+1+next);
    const timeout=google.match(/AbortSignal\.timeout\(\s*([0-9_]+(?:e[0-9]+)?)\s*\)/i)?.[1];
    return {directDefaultExport:/export\s+default\b/.test(value),
      listDefaultExport:/export\s*\{[^}]*\bas\s+default\b/s.test(value),
      directCoordinatorExport:/export\s+class\s+CrmEventCoordinator\b/.test(value),
      wranglerSourcePreamble:/^\s*\/\/\s*workers\/resend-webhook\.js/.test(value),
      boundedWebhookBody:/\breadWebhookBody\s*\(/.test(value)&&/\bMAX_BODY\s*=\s*65_?536\b/.test(value),
      googleRequestHelper:start>=0,
      googleRedirectManual:/redirect\s*:\s*["']manual["']/.test(google),
      googleTimeout12000:timeout!==undefined&&Number(timeout.replaceAll('_',''))===12000,
      boundedGoogleAccessToken:/\.access_token\.length\s*>\s*4096\b/.test(value),
      activeWriterFailureRetries:compact.includes('if(writeRequested)returnretryWrite(reason)'),
      coordinatorMandatory:compact.includes('if(!env?.CRM_COORDINATOR)returnresponse(')};
  };
  const canonical=value=>trimEnd(withoutMap(lineEndings(withoutBom(value))));
  return {kind:'source_hash_mismatch',diagnosticOnly:true,
    local:{sha256:sha(local),bytes:bytes(local),crlfCount:(local.match(/\r\n/g)||[]).length,
      hasBom:local.startsWith('\uFEFF'),markers:markers(local)},
    remote:{sha256:sha(remote),bytes:bytes(remote),crlfCount:(remote.match(/\r\n/g)||[]).length,
      hasBom:remote.startsWith('\uFEFF'),markers:markers(remote)},
    equivalentAfter:{lineEndings:lineEndings(local)===lineEndings(remote),
      trailingWhitespace:trimEnd(local)===trimEnd(remote),
      sourceMapTrailer:withoutMap(local)===withoutMap(remote),
      bom:withoutBom(local)===withoutBom(remote),
      combinedTransportNormalization:canonical(local)===canonical(remote)}};
}
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
function contentKind(type){
  const mime=String(type||'').split(';',1)[0].trim().toLowerCase();
  return ({'multipart/form-data':'multipart_form_data','multipart/mixed':'multipart_mixed',
    'application/javascript+module':'javascript_module','application/javascript':'javascript',
    'application/x-javascript':'javascript','text/javascript':'javascript','text/plain':'text_plain',
    'application/json':'json','application/octet-stream':'octet_stream','application/source-map':'source_map'})[mime]
    ||(mime?'other':'missing');
}
function extensionKind(name){
  const extension=String(name||'').match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  return ['js','mjs','map','json'].includes(extension)?extension:extension?'other':'none';
}
function markerFlags(source){
  return {svix:/\bverifySvix(?:Detailed)?\b/.test(source),coordinator:/\bCrmEventCoordinator\b/.test(source),
    crmId:source.includes(CRM_ID),webhookRoute:source.includes('/webhooks/resend'),
    defaultExport:/export\s+default\b|export\s*\{[^}]*\bas\s+default\b/s.test(source),
    importsPresent:/^\s*import\b/m.test(source)};
}
async function sourceText(response,operation='worker_source'){
  const type=response.headers.get('Content-Type')||'';
  const safeHeaderNames=new Set(['content-type','content-length','content-disposition','content-encoding',
    'transfer-encoding','cache-control','date','server','etag','last-modified','vary','cf-ray','x-content-type-options']);
  const diagnostic={stage:'body_read',contentType:contentKind(type),bytes:0,
    headerNames:[...new Set([...response.headers.keys()].map(name=>safeHeaderNames.has(name)?name:'other'))].sort()};
  try{
    const bytes=await boundedBody(response);diagnostic.bytes=bytes.byteLength;
    try{diagnostic.ownedMarkers=markerFlags(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}catch{}
    if(['multipart_form_data','multipart_mixed'].includes(diagnostic.contentType)){
      diagnostic.stage='multipart_parse';
      let parts;try{parts=await new Response(bytes,{headers:{'Content-Type':type.replace(/^multipart\/mixed/i,'multipart/form-data')}}).formData();}
      catch{throw new VerifyError('worker_source_unverified');}
      const entries=[...parts];diagnostic.partCount=entries.length;
      diagnostic.parts=entries.map(([name,part])=>({
        fieldKind:name==='metadata'?'metadata':extensionKind(name),
        fileExtension:typeof part==='string'?'none':extensionKind(part.name),
        kind:typeof part==='string'?'text':'file',
        contentType:typeof part==='string'?'text':contentKind(part.type)
      }));
      diagnostic.stage='module_selection';
      const modules=[],maps=[];let mainModule;
      for(const [name,part]of entries){
        diagnostic.stage='part_name';
        // Multipart field names identify modules in the upload API. A downloaded
        // generic field may instead identify its module through File.name.
        const namedModule=/^[A-Za-z0-9._-]+\.m?js(?:\.map)?$/.test(name)||name==='metadata'||name==='metadata.json';
        const filename=typeof part==='string'||namedModule?name:part.name||name;
        const text=typeof part==='string'?part:
          new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await part.arrayBuffer());
        if(name==='metadata'||filename==='metadata.json'){
          diagnostic.stage='metadata_validation';
          let metadata;try{metadata=JSON.parse(text);}catch{throw new VerifyError('worker_source_unverified');}
          if(metadata.main_module!==undefined){
            requireValue(typeof metadata.main_module==='string'&&/^[A-Za-z0-9._-]+\.m?js$/.test(metadata.main_module),'worker_source_unverified');
            mainModule=metadata.main_module;
          }
          continue;
        }
        if(/^[A-Za-z0-9._-]+\.m?js$/.test(filename)){modules.push({name:filename,text});continue;}
        if(/^[A-Za-z0-9._-]+\.m?js\.map$/.test(filename)){
          diagnostic.stage='source_map_validation';
          let map;try{map=JSON.parse(text);}catch{throw new VerifyError('worker_source_unverified');}
          requireValue(map?.version===3&&Array.isArray(map.sources)&&map.sources.every(x=>typeof x==='string')
            &&typeof map.mappings==='string'
            &&(map.file===undefined||typeof map.file==='string'),'worker_source_unverified');
          maps.push({name:filename,file:map.file});continue;
        }
        throw new VerifyError('worker_source_unverified');
      }
      diagnostic.stage='module_count';
      diagnostic.moduleCount=modules.length;
      diagnostic.mainModuleMatches=mainModule===undefined||modules.some(module=>module.name===mainModule);
      requireValue(modules.length===1&&(!mainModule||mainModule===modules[0].name),'worker_source_unverified');
      diagnostic.stage='source_map_match';
      diagnostic.sourceMapsMatch=maps.every(map=>map.name===modules[0].name+'.map'
        &&(!map.file||map.file===modules[0].name));
      requireValue(maps.every(map=>map.name===modules[0].name+'.map'
        &&(!map.file||map.file===modules[0].name)),'worker_source_unverified');
      diagnostic.ownedMarkers=markerFlags(modules[0].text);
      return modules[0].text;
    }
    diagnostic.stage='content_type';
    requireValue(['javascript_module','javascript','text_plain'].includes(diagnostic.contentType),'worker_source_unverified');
    diagnostic.stage='utf8_decode';
    try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
    catch{throw new VerifyError('worker_source_unverified');}
  }catch(error){
    const failure=error instanceof VerifyError?error:new VerifyError('worker_source_unverified');
    failure.operation=operation;failure.diagnostic=diagnostic;throw failure;
  }
}
export async function verifyResendWebhookReadOnly({env,source,fetcher=fetch}={}){
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
    async function cf(path,{operation='cloudflare_read',raw=false}={}){
      let response;
      try{response=await fetcher('https://api.cloudflare.com/client/v4'+path,{
        method:'GET',headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN},
        redirect:'error',signal:AbortSignal.timeout(20_000)});}
      catch{throw new VerifyError('cloudflare_unreachable',undefined,operation);}
      if(response.status===404)throw new VerifyError('existing_worker_not_found',404,operation);
      if(!response.ok)throw new VerifyError('cloudflare_request_rejected',response.status,operation);
      if(raw)return response;
      let result;try{result=await response.json();}catch{throw new VerifyError('invalid_cloudflare_response',undefined,operation);}
      requireValue(result?.success===true&&result.result!==undefined,'invalid_cloudflare_response');return result.result;
    }
    let account=env.CLOUDFLARE_ACCOUNT_ID||'';
    if(!account){
      const accounts=await cf('/accounts?per_page=50',{operation:'account_discovery'});
      requireValue(Array.isArray(accounts)&&accounts.length===1,'account_selection_required');account=accounts[0]?.id;
    }
    requireValue(ID.test(account),'invalid_account_id');
    const base='/accounts/'+account,worker=base+'/workers/scripts/'+WORKER;
    const settings=await cf(worker+'/settings',{operation:'worker_settings'}),retained=bindings(settings);
    const remote=await sourceText(await cf(worker+'/content/v2',{raw:true,operation:'worker_source'}),'worker_source');
    requireValue(ownedSource(remote),'worker_ownership_unverified');
    if(sha(remote)!==sha(source)){
      const error=new VerifyError('published_code_hash_mismatch',undefined,'worker_source_hash');
      error.diagnostic=sourceDifference(source,remote);throw error;
    }
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
    let health;
    try{
      const response=await fetcher(publicOrigin+'/health',{
        method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15_000)});
      const data=await response.json();
      health=response.status===200&&response.headers.get('Cache-Control')==='no-store'
        &&response.headers.get('X-Content-Type-Options')==='nosniff'
        &&data?.status==='ok'&&data.sending_enabled===false&&typeof data.crm_writes_enabled==='boolean'
        &&Object.keys(data).sort().join(',')==='crm_writes_enabled,sending_enabled,status';
    }catch{health=false;}
    requireValue(health,'public_health_unverified');
    let unsigned;
    try{
      // Deliberately lacks every Svix authentication header: the handler must
      // reject this fixed empty object before reading the CRM or processing data.
      unsigned=await fetcher(publicOrigin+'/webhooks/resend',{
        method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15_000),
        headers:{'Content-Type':'application/json'},body:'{}'});
    }catch{throw new VerifyError('unsigned_request_unverified');}
    let rejected;try{rejected=await unsigned.json();}catch{throw new VerifyError('unsigned_request_unverified');}
    requireValue(unsigned.status===401&&unsigned.headers.get('Cache-Control')==='no-store'
      &&rejected?.error==='unauthorized'&&Object.keys(rejected).length===1,'unsigned_request_unverified');
    // Re-read bindings and public exposure state to detect unrelated concurrent
    // administration, while this verifier itself performs no Cloudflare mutation.
    const after=await cf(worker+'/settings',{operation:'verify_bindings_readback'});
    const afterDomain=await cf(worker+'/subdomain',{operation:'verify_subdomain_readback'});
    requireValue(same(retained,bindings(after)),'worker_bindings_changed_during_verification');
    requireValue(same(subdomain,afterDomain),'worker_subdomain_changed_during_verification');
    return {readOnly:true,installed:false,verified:true,code:'webhook_read_only_verified',
      cloudflareMutations:0,sourceSha256:sha(source),bindingsVerified:retained.length,
      workersDevStateUnchanged:true,unauthenticatedEventRejected:true,
      observability:{...observationFlags(after),verifiedDisabled:observationDisabled(after)}};
  }catch(error){return {readOnly:true,installed:false,verified:false,cloudflareMutations:0,
    code:error instanceof VerifyError?error.code:'webhook_verification_failed',
    ...(error instanceof VerifyError&&error.httpStatus?{httpStatus:error.httpStatus,operation:error.operation}:{}),
    ...(error instanceof VerifyError&&error.diagnostic?{operation:error.operation,diagnostic:error.diagnostic}:{})};}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let result;
  if(process.argv.slice(2).some(arg=>arg!=='--verify-only')){
    result={readOnly:true,installed:false,verified:false,cloudflareMutations:0,code:'invalid_arguments'};
  }else{
    try{result=await verifyResendWebhookReadOnly({env:process.env,
      source:await readFile(new URL('../workers/resend-webhook.js',import.meta.url),'utf8')});}
    catch{result={readOnly:true,installed:false,verified:false,cloudflareMutations:0,code:'local_source_unavailable'};}
  }
  console.log(JSON.stringify(result,null,2));
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
    '## Verificação de leitura do webhook Time Saver\n\nResultado: '+result.code+'\n\n'
    +'Sem upload, alterações de configuração ou eventos autenticados.\n'
    +'A observabilidade é apenas consultada e não é alterada por esta verificação.\n');
  if(!result.verified)process.exitCode=1;
}
