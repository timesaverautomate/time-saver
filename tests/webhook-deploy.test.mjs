import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deployResendWebhook} from '../scripts/deploy-resend-webhook.mjs';

const SOURCE=await readFile(new URL('../workers/resend-webhook.js',import.meta.url),'utf8');
const WORKER='timesaver-resend-webhook';
const PROJECT='1452563434';
const ACCOUNT='a'.repeat(32);
const PUBLIC='https://'+WORKER+'.time-saver-fixture.workers.dev';
const originalBindings=()=>[
  {type:'secret_text',name:'RESEND_WEBHOOK_SECRET'},
  {type:'secret_text',name:'GOOGLE_SERVICE_ACCOUNT_JSON'},
  {type:'secret_text',name:'EXTRA_EXISTING_SECRET'},
  {type:'plain_text',name:'RESEND_WEBHOOK_WRITE_ENABLED',text:'false'},
  {type:'plain_text',name:'RESEND_CRM_GENERAL_WRITE_ENABLED',text:'false'},
  {type:'json',name:'EXTRA_SETTINGS',json:{unchanged:true}},
  {type:'kv_namespace',name:'EXTRA_NAMESPACE',namespace_id:'c'.repeat(32)},
  {type:'durable_object_namespace',name:'CRM_COORDINATOR',class_name:'CrmEventCoordinator',namespace_id:'b'.repeat(32)}
];
function fixture({missingWorker=false,remoteSource=SOURCE,multipart=false,subdomainEnabled=true,
  domains=[{service:WORKER,hostname:'events.timesaverautomate.com'}],accountCount=1,
  settingsChanged=false,sourceChanged=false,bindingsChanged=false,subdomainChanged=false,
  storedSourceChanged=false,uploadStatus=200,healthExtra=false,unsignedStatus=401,mutateBindings,
  genericField=false,sourceMap=false,badSourceMap=false,extraModule=false,mixed=false,
  sourceContentType='application/javascript+module',responseHeaderSecret=false,genericFilename=false}={}){
  const calls=[],uploads=[];
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY_ID:PROJECT,GITHUB_REPOSITORY:'timesaverautomate/time-saver',
    GITHUB_REF:'refs/heads/main',GITHUB_SHA:'1'.repeat(40),GITHUB_RUN_ID:'12345',GITHUB_EVENT_NAME:'push',
    GITHUB_WORKFLOW_REF:'timesaverautomate/time-saver/.github/workflows/webhook-security.yml@refs/heads/main',
    CLOUDFLARE_API_TOKEN:'unit-test-cloudflare-key-'.repeat(2)};
  let settings={compatibility_date:'2026-11-01',compatibility_flags:['nodejs_compat'],logpush:false,
    limits:{cpu_ms:10000},placement:{mode:'smart'},tags:['time-saver'],tail_consumers:[],
    observability:{enabled:true},bindings:originalBindings()};
  if(mutateBindings)settings.bindings=mutateBindings(settings.bindings);
  let content=remoteSource,settingsReads=0,sourceReads=0;
  const subdomain={enabled:subdomainEnabled,previews_enabled:false};
  const json=result=>Response.json({success:true,result});
  const response=data=>Response.json(data,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  const fetcher=async(url,options={})=>{
    calls.push({url,options});const u=new URL(url),path=u.pathname;
    if(u.hostname!=='api.cloudflare.com'){
      assert.ok([PUBLIC,'https://events.timesaverautomate.com'].includes(u.origin));
      assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
      assert.equal(new Headers(options.headers).has('Authorization'),false);
      if(path==='/health')return response({status:'ok',sending_enabled:false,crm_writes_enabled:false,...(healthExtra?{internal:'not-for-public'}:{})});
      assert.equal(path,'/webhooks/resend');assert.equal(options.method,'POST');assert.equal(options.body,'{}');
      assert.equal(new Headers(options.headers).has('svix-signature'),false);
      return Response.json({error:'unauthorized'},{status:unsignedStatus,headers:{'Cache-Control':'no-store'}});
    }
    assert.equal(options.headers.Authorization,'Bearer '+env.CLOUDFLARE_API_TOKEN);
    assert.equal(options.redirect,'error');
    if(path==='/client/v4/accounts')return json(Array.from({length:accountCount},()=>({id:ACCOUNT})));
    if(path==='/client/v4/accounts/'+ACCOUNT+'/workers/subdomain')return json({subdomain:'time-saver-fixture'});
    if(path==='/client/v4/accounts/'+ACCOUNT+'/workers/domains')return json(domains);
    const base='/client/v4/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER;
    if(path===base+'/settings'){
      settingsReads++;
      if(missingWorker)return new Response('',{status:404});
      const data=structuredClone(settings);
      if(settingsChanged&&settingsReads===2)data.bindings.find(b=>b.type==='plain_text').text='changed-concurrently';
      if(bindingsChanged&&uploads.length)data.bindings=data.bindings.filter(b=>b.name!=='EXTRA_EXISTING_SECRET');
      return json(data);
    }
    if(path===base+'/content/v2'){
      sourceReads++;
      const text=(sourceChanged&&sourceReads===2)||(storedSourceChanged&&uploads.length)?content+'\n// changed':content;
      if(multipart){
        const form=new FormData();form.set(genericField?'script':'worker.mjs',new Blob([text],{type:'application/javascript+module'}),genericFilename?'blob':'worker.mjs');
        if(sourceMap)form.set('source-map',new Blob([JSON.stringify({version:badSourceMap?2:3,file:'worker.mjs',sources:['private-original-file.js'],sourcesContent:[text],names:[],mappings:''})],{type:'application/json'}),'worker.mjs.map');
        if(extraModule)form.set('extra.js',new Blob(['export default "private-extra-module"'],{type:'application/javascript+module'}),'extra.js');
        const response=new Response(form);
        if(mixed)response.headers.set('Content-Type',response.headers.get('Content-Type').replace('multipart/form-data','multipart/mixed'));
        return response;
      }
      return new Response(text,{headers:{'Content-Type':sourceContentType,...(responseHeaderSecret?{'x-private-debug':'private-header-value'}:{})}});
    }
    if(path===base+'/subdomain'){
      assert.equal(options.method,'GET');return json({...subdomain,...(subdomainChanged&&uploads.length?{enabled:!subdomain.enabled}:{})});
    }
    assert.equal(path,base);assert.equal(options.method,'PUT');assert.equal(u.search,'?bindings_inherit=strict');
    assert.ok(options.body instanceof FormData);
    const metadata=JSON.parse(await options.body.get('metadata').text());
    const source=await options.body.get('worker.mjs').text();uploads.push({metadata,source});
    if(uploadStatus!==200)return Response.json({success:false,errors:[{message:env.CLOUDFLARE_API_TOKEN}]},{status:uploadStatus});
    assert.deepEqual(metadata.bindings,settings.bindings.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(b=>({name:b.name,type:'inherit'})));
    assert.equal(metadata.migrations,undefined);assert.equal(metadata.observability.enabled,false);
    const inherited=metadata.bindings.map(b=>structuredClone(settings.bindings.find(old=>old.name===b.name)));
    settings={...settings,...metadata,bindings:inherited};content=source;
    return json({id:WORKER});
  };
  return {env,calls,uploads,options:{env,source:SOURCE,fetcher,attempts:1,sleep:async()=>{}}};
}

test('webhook deploy is blocked outside exact main workflow or without credentials before any network',async()=>{
  for(const changed of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY_ID:'2'},{GITHUB_REPOSITORY:'other/project'},
    {GITHUB_REF:'refs/heads/other'},{GITHUB_SHA:'not-a-sha'},{GITHUB_RUN_ID:''},{GITHUB_EVENT_NAME:'pull_request'},
    {GITHUB_WORKFLOW_REF:'timesaverautomate/time-saver/.github/workflows/other.yml@refs/heads/main'},
    {CLOUDFLARE_API_TOKEN:''},{CLOUDFLARE_API_TOKEN:'unsafe\nvalue'}]){
    const f=fixture();Object.assign(f.env,changed);const result=await deployResendWebhook(f.options);
    assert.equal(result.installed,false);assert.equal(result.verified,false);assert.equal(f.calls.length,0);
  }
  const f=fixture();f.options.source='export default {}';assert.equal((await deployResendWebhook(f.options)).code,'invalid_local_source');assert.equal(f.calls.length,0);
});

test('missing Worker, ambiguous account, wrong source, missing or wrong coordinator never mutate resources',async()=>{
  const cases=[{missingWorker:true},{accountCount:2},{remoteSource:'export default {fetch(){return new Response("other application")}};'},
    {mutateBindings:b=>b.filter(x=>x.name!=='CRM_COORDINATOR')},
    {mutateBindings:b=>b.map(x=>x.name==='CRM_COORDINATOR'?{...x,class_name:'OtherCoordinator'}:x)},
    {mutateBindings:b=>b.map(x=>x.name==='CRM_COORDINATOR'?{...x,script_name:'some-other-worker'}:x)},
    {mutateBindings:b=>b.map(x=>x.name==='CRM_COORDINATOR'?{...x,namespace_id:''}:x)},
    {mutateBindings:b=>b.filter(x=>x.name!=='RESEND_WEBHOOK_SECRET')},
    {mutateBindings:b=>[...b,b[0]]}];
  for(const config of cases){const f=fixture(config),r=await deployResendWebhook(f.options);assert.equal(r.installed,false,JSON.stringify(config));assert.equal(f.uploads.length,0);assert.ok(f.calls.every(x=>x.options.method==='GET'));}
});

test('existing account selection is explicit and failure cannot expose provider error details',async()=>{
  const f=fixture();f.env.CLOUDFLARE_ACCOUNT_ID=ACCOUNT;
  const r=await deployResendWebhook(f.options);assert.equal(r.verified,true);
  assert.equal(f.calls.some(x=>new URL(x.url).pathname==='/client/v4/accounts'),false);
  const broken=fixture();broken.options.fetcher=async()=>Response.json({success:false,errors:[{message:broken.env.CLOUDFLARE_API_TOKEN}]},{status:403});
  const failure=await deployResendWebhook(broken.options);assert.deepEqual(failure,{installed:false,verified:false,code:'cloudflare_request_rejected',httpStatus:403,operation:'account_discovery'});
  assert.ok(!JSON.stringify(failure).includes(broken.env.CLOUDFLARE_API_TOKEN));
});

test('single-module upload strictly inherits every binding including secrets, flags and existing DO namespaces',async()=>{
  const f=fixture();const result=await deployResendWebhook(f.options);assert.equal(result.verified,true);assert.equal(result.code,'webhook_security_verified');
  assert.match(result.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(result.bindingsRetained,originalBindings().length);assert.equal(f.uploads.length,1);
  const m=f.uploads[0].metadata;
  assert.equal(m.main_module,'worker.mjs');assert.equal(m.compatibility_date,'2026-11-01');
  assert.deepEqual(m.compatibility_flags,['nodejs_compat']);assert.deepEqual(m.limits,{cpu_ms:10000});assert.deepEqual(m.placement,{mode:'smart'});
  assert.deepEqual(m.tags,['time-saver']);assert.deepEqual(m.tail_consumers,[]);assert.equal(m.logpush,false);assert.equal(m.keep_assets,undefined);
  assert.ok(m.bindings.every(b=>Object.keys(b).sort().join(',')==='name,type'&&b.type==='inherit'));
  assert.ok(!JSON.stringify(m).includes(f.env.CLOUDFLARE_API_TOKEN));
  assert.ok(f.calls.every(c=>!/(?:billing|subscriptions|migrations|dns_records|\/secrets)/.test(c.url)));
  assert.deepEqual(f.calls.filter(c=>c.options.method!=='GET').map(c=>c.options.method),['PUT','POST']);
  const publicPOST=f.calls.find(c=>!c.url.startsWith('https://api.cloudflare.com')&&c.options.method==='POST');assert.ok(publicPOST);assert.equal(publicPOST.options.body,'{}');
});

test('existing assets binding also retains its assets without creating or modifying them',async()=>{
  const f=fixture({mutateBindings:b=>[...b,{name:'EXISTING_ASSETS',type:'assets'}]});
  assert.equal((await deployResendWebhook(f.options)).verified,true);
  assert.equal(f.uploads[0].metadata.keep_assets,true);
  assert.ok(f.uploads[0].metadata.bindings.some(b=>b.name==='EXISTING_ASSETS'&&b.type==='inherit'));
});

test('multipart source is verified without printing it and public health does not process authenticated events',async()=>{
  const f=fixture({multipart:true});const result=await deployResendWebhook(f.options);assert.equal(result.verified,true);
  assert.equal(f.uploads[0].source,SOURCE);assert.ok(!JSON.stringify(result).includes(SOURCE));
  assert.equal(f.calls.filter(c=>!c.url.startsWith('https://api.cloudflare.com')).length,2);
  assert.ok(f.calls.every(c=>!c.url.includes('googleapis.com')&&!c.url.includes('resend.com')));
});

test('ownership verification accepts the existing Wrangler bundle export list as well as direct ESM exports',async()=>{
  const bundled=SOURCE.replace(/export\s+(?=(?:async\s+)?function\b)/g,'')
    .replace('export class CrmEventCoordinator','var CrmEventCoordinator = class')
    .replace('export default {','const webhook_default = {')
    +'\nexport { CrmEventCoordinator, webhook_default as default };\n';
  const f=fixture({remoteSource:bundled});assert.equal((await deployResendWebhook(f.options)).verified,true);
  assert.equal(f.uploads[0].source,SOURCE);
});

test('disabled workers.dev remains disabled and an existing unique custom domain is used for verification',async()=>{
  const f=fixture({subdomainEnabled:false});const result=await deployResendWebhook(f.options);
  assert.equal(result.verified,true);assert.equal(result.workersDevStatePreserved,true);
  assert.ok(f.calls.some(c=>c.url==='https://events.timesaverautomate.com/health'));
  assert.equal(f.calls.some(c=>c.url===PUBLIC+'/health'),false);
  assert.ok(f.calls.filter(c=>c.url.endsWith('/subdomain')).every(c=>c.options.method==='GET'));
  for(const domains of [[],[{service:'other-worker',hostname:'events.timesaverautomate.com'}],
    [{service:WORKER,hostname:'untrusted.invalid'}],
    [{service:WORKER,hostname:'a.timesaverautomate.com'},{service:WORKER,hostname:'b.timesaverautomate.com'}]]){
    const bad=fixture({subdomainEnabled:false,domains});assert.equal((await deployResendWebhook(bad.options)).code,'public_verification_unavailable');assert.equal(bad.uploads.length,0);
  }
});

test('concurrent settings or code changes fail closed before upload',async()=>{
  for(const config of [{settingsChanged:true},{sourceChanged:true}]){
    const f=fixture(config),r=await deployResendWebhook(f.options);assert.equal(r.code,'worker_changed_during_preflight');assert.equal(f.uploads.length,0);
  }
});

test('upload failure, changed bindings, worker subdomain or source never return verified success',async()=>{
  for(const [config,code]of [[{uploadStatus:403},'cloudflare_request_rejected'],[{bindingsChanged:true},'worker_bindings_changed'],
    [{subdomainChanged:true},'worker_subdomain_changed'],[{storedSourceChanged:true},'worker_source_unverified']]){
    const f=fixture(config),r=await deployResendWebhook(f.options);assert.equal(r.verified,false);assert.equal(r.code,code);
    assert.ok(!JSON.stringify(r).includes(f.env.CLOUDFLARE_API_TOKEN));
  }
});

test('extra public diagnostic fields or accepted unsigned events are reported as verification failure',async()=>{
  for(const [config,code]of [[{healthExtra:true},'public_health_unverified'],[{unsignedStatus:200},'unsigned_request_unverified']]){
    const f=fixture(config),r=await deployResendWebhook(f.options);assert.equal(r.installed,true);assert.equal(r.verified,false);assert.equal(r.code,code);
  }
});

test('workflow has repository guard, pinned actions, read-only permissions and secret scoped to deploy after checks',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/webhook-security.yml',import.meta.url),'utf8');
  assert.match(workflow,/github.repository_id == '1452563434'/);assert.match(workflow,/github.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/permissions: \{\}/);assert.match(workflow,/contents: read/);assert.doesNotMatch(workflow,/statuses: write|pull_request_target|id-token: write/);
  for(const match of workflow.matchAll(/uses:\s*[^@\s]+@([^\s]+)/g))assert.match(match[1],/^[a-f0-9]{40}$/);
  assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/fetch-depth: 0/);
  assert.ok(workflow.indexOf('npm run check')<workflow.indexOf('CLOUDFLARE_API_TOKEN:'));
  assert.ok(workflow.indexOf('audit-repository-secrets.py')<workflow.indexOf('CLOUDFLARE_API_TOKEN:'));
  assert.match(workflow,/secrets.CLOUDFLARE_SITE_API_TOKEN \|\| secrets.CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(workflow,/RESEND_API_KEY|GOOGLE_SERVICE_ACCOUNT_JSON|GITHUB_TOKEN/);
});

test('Cloudflare multipart main module is selected by File.name with a generic field and matching validated source map',async()=>{
  for(const mixed of [false,true]){
    const f=fixture({multipart:true,genericField:true,sourceMap:true,mixed});
    assert.equal((await deployResendWebhook(f.options)).verified,true);assert.equal(f.uploads[0].source,SOURCE);
  }
  const namedField=fixture({multipart:true,genericFilename:true});
  assert.equal((await deployResendWebhook(namedField.options)).verified,true);
});

test('malformed maps and multiple code modules fail closed before upload with classified diagnostics only',async()=>{
  for(const setup of [{multipart:true,genericField:true,sourceMap:true,badSourceMap:true},{multipart:true,extraModule:true}]){
    const f=fixture(setup),r=await deployResendWebhook(f.options);
    assert.equal(r.installed,false);assert.equal(r.code,'worker_source_unverified');assert.equal(f.uploads.length,0);
    assert.equal(r.operation,'worker_source');assert.equal(r.diagnostic.contentType,'multipart_form_data');
    assert.ok(r.diagnostic.bytes>0);assert.ok(r.diagnostic.partCount>=2);assert.ok(Array.isArray(r.diagnostic.parts));
    assert.equal(r.diagnostic.ownedMarkers.svix,true);assert.equal(r.diagnostic.ownedMarkers.crmId,true);
    const output=JSON.stringify(r);assert.ok(!output.includes(SOURCE));assert.ok(!output.includes('private-original-file'));
    assert.ok(!output.includes('private-extra-module'));assert.ok(!output.includes(f.env.CLOUDFLARE_API_TOKEN));
  }
});

test('unsupported content types expose category, byte count and marker booleans but never type parameters or header values',async()=>{
  const f=fixture({sourceContentType:'application/octet-stream; private=private-content-type-value',responseHeaderSecret:true});
  const r=await deployResendWebhook(f.options);assert.equal(r.installed,false);assert.equal(f.uploads.length,0);
  assert.equal(r.code,'worker_source_unverified');assert.equal(r.diagnostic.stage,'content_type');assert.equal(r.diagnostic.contentType,'octet_stream');
  assert.ok(r.diagnostic.headerNames.includes('content-type'));assert.ok(r.diagnostic.headerNames.includes('other'));
  assert.equal(r.diagnostic.ownedMarkers.svix,true);assert.equal(r.diagnostic.ownedMarkers.coordinator,true);
  const output=JSON.stringify(r);for(const value of ['private-header-value','private-content-type-value','x-private-debug',SOURCE])assert.ok(!output.includes(value));
});
