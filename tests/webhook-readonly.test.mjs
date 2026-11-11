import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyResendWebhookReadOnly} from '../scripts/verify-resend-webhook-readonly.mjs';
const SOURCE=await readFile(new URL('../workers/resend-webhook.js',import.meta.url),'utf8');
const ACCOUNT='a'.repeat(32),WORKER='timesaver-resend-webhook';
const ORIGIN='https://'+WORKER+'.time-saver-fixture.workers.dev';
const digest=text=>createHash('sha256').update(text).digest('hex');
const buildConfig='name = "timesaver-resend-webhook"\nmain = "workers/resend-webhook.js"\n';
function proofFor(compiled){return {schemaVersion:1,builder:'wrangler@4.160.0',
  sourceFile:'workers/resend-webhook.js',sourceSha256:digest(SOURCE),sourceBytes:Buffer.byteLength(SOURCE),
  configFile:'wrangler.toml',configSha256:digest(buildConfig),
  compiledSha256:digest(compiled),compiledBytes:Buffer.byteLength(compiled)};}
function fixture({observability={enabled:true,logs:{enabled:true,invocation_logs:true}},remoteSource=SOURCE,
  bindingChange=false,missingCoordinator=false,wrongClass=false,unsignedStatus=401,healthExtra=false,
  multipart=false,missingWorker=false,subdomainEnabled=true}={}){
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY_ID:'1452563434',GITHUB_REPOSITORY:'timesaverautomate/time-saver',
    GITHUB_REF:'refs/heads/main',GITHUB_SHA:'1'.repeat(40),GITHUB_RUN_ID:'12345',GITHUB_EVENT_NAME:'push',
    GITHUB_WORKFLOW_REF:'timesaverautomate/time-saver/.github/workflows/webhook-security.yml@refs/heads/main',
    CLOUDFLARE_API_TOKEN:'unit-test-cloudflare-key-'.repeat(2)};
  const calls=[],config={observability,compatibility_date:'2026-11-01',bindings:[
    {type:'secret_text',name:'RESEND_WEBHOOK_SECRET'},{type:'secret_text',name:'GOOGLE_SERVICE_ACCOUNT_JSON'},
    {type:'plain_text',name:'RESEND_WEBHOOK_WRITE_ENABLED',text:'true'},
    {type:'plain_text',name:'RESEND_CRM_GENERAL_WRITE_ENABLED',text:'false'},
    {type:'durable_object_namespace',name:'CRM_COORDINATOR',class_name:wrongClass?'OtherCoordinator':'CrmEventCoordinator',namespace_id:'b'.repeat(32)}
  ].filter(b=>!missingCoordinator||b.name!=='CRM_COORDINATOR')};
  if(observability===null)delete config.observability;
  let reads=0;
  const fetcher=async(url,options)=>{
    calls.push({url,options});const u=new URL(url),path=u.pathname;
    if(u.hostname==='api.cloudflare.com'){
      assert.equal(options.method,'GET','Authenticated Cloudflare calls must never mutate resources');
      assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,'Bearer '+env.CLOUDFLARE_API_TOKEN);
      if(path==='/client/v4/accounts')return Response.json({success:true,result:[{id:ACCOUNT}]});
      if(path==='/client/v4/accounts/'+ACCOUNT+'/workers/subdomain')return Response.json({success:true,result:{subdomain:'time-saver-fixture'}});
      if(path==='/client/v4/accounts/'+ACCOUNT+'/workers/domains')return Response.json({success:true,result:[{service:WORKER,hostname:'events.timesaverautomate.com'}]});
      const base='/client/v4/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER;
      if(path===base+'/settings'){
        reads++;if(missingWorker)return new Response('',{status:404});
        const value=structuredClone(config);if(bindingChange&&reads===2)value.bindings.find(b=>b.type==='plain_text').text='changed-elsewhere';
        return Response.json({success:true,result:value});
      }
      if(path===base+'/content/v2'){
        if(multipart){const form=new FormData();form.set('script',new Blob([remoteSource],{type:'application/javascript+module'}),'worker.mjs');return new Response(form);}
        return new Response(remoteSource,{headers:{'Content-Type':'application/javascript+module'}});
      }
      assert.equal(path,base+'/subdomain');return Response.json({success:true,result:{enabled:subdomainEnabled,previews_enabled:false}});
    }
    assert.ok([ORIGIN,'https://events.timesaverautomate.com'].includes(u.origin));
    assert.equal(new Headers(options.headers).has('Authorization'),false);assert.equal(options.credentials,'omit');
    if(path==='/health')return Response.json({status:'ok',sending_enabled:false,crm_writes_enabled:false,...(healthExtra?{internal:'private-detail'}:{})},
      {headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    assert.equal(path,'/webhooks/resend');assert.equal(options.method,'POST');assert.equal(options.body,'{}');
    assert.equal(new Headers(options.headers).has('svix-signature'),false);
    return Response.json({error:'unauthorized'},{status:unsignedStatus,headers:{'Cache-Control':'no-store'}});
  };
  return {env,calls,config,options:{env,source:SOURCE,fetcher}};
}

test('read-only verification succeeds for enabled, disabled and unreported observability without any Cloudflare mutation',async()=>{
  for(const observability of [null,{}, {enabled:true,logs:{enabled:true,invocation_logs:true}},
    {enabled:false,logs:{enabled:false,invocation_logs:false}}]){
    const f=fixture({observability}),before=structuredClone(f.config);
    const r=await verifyResendWebhookReadOnly(f.options);
    assert.equal(r.verified,true,JSON.stringify(r));assert.equal(r.readOnly,true);assert.equal(r.installed,false);assert.equal(r.cloudflareMutations,0);
    assert.equal(r.code,'webhook_read_only_verified');assert.match(r.sourceSha256,/^[a-f0-9]{64}$/);
    assert.deepEqual(f.config,before,'existing flags and bindings must remain unchanged');
    assert.ok(f.calls.filter(c=>c.url.startsWith('https://api.cloudflare.com/')).every(c=>c.options.method==='GET'&&c.options.body===undefined));
    assert.deepEqual(f.calls.filter(c=>!c.url.startsWith('https://api.cloudflare.com/')).map(c=>c.options.method),['GET','POST']);
    assert.equal(r.observability.enabled,typeof observability?.enabled==='boolean'?observability.enabled:'not_reported');
    assert.equal(r.observability.verifiedDisabled,observability?.enabled===false);
  }
});

test('different remote code, unknown ownership and missing or wrong coordinator fail before public probes',async()=>{
  for(const [setup,code]of [[{remoteSource:SOURCE+'\n// different deployed source'},'published_code_hash_mismatch'],
    [{remoteSource:'export default {fetch(){return new Response("other application")}};'},'worker_ownership_unverified'],
    [{missingCoordinator:true},'coordinator_binding_unverified'],[{wrongClass:true},'coordinator_binding_unverified'],
    [{missingWorker:true},'existing_worker_not_found']]){
    const f=fixture(setup),r=await verifyResendWebhookReadOnly(f.options);assert.equal(r.verified,false);assert.equal(r.installed,false);assert.equal(r.code,code);
    assert.ok(f.calls.every(c=>c.url.startsWith('https://api.cloudflare.com/')&&c.options.method==='GET'));
  }
});

test('invalid workflow or credential context causes no network or changes',async()=>{
  for(const changes of [{GITHUB_ACTIONS:'false'},{GITHUB_REF:'refs/heads/other'},{GITHUB_REPOSITORY_ID:'2'},
    {GITHUB_SHA:''},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_WORKFLOW_REF:'other/workflow'}, {CLOUDFLARE_API_TOKEN:''}]){
    const f=fixture();Object.assign(f.env,changes);const r=await verifyResendWebhookReadOnly(f.options);
    assert.equal(r.verified,false);assert.equal(r.cloudflareMutations,0);assert.equal(f.calls.length,0);
  }
});

test('multipart module verification and existing custom-domain checks remain read only',async()=>{
  const f=fixture({multipart:true,subdomainEnabled:false}),r=await verifyResendWebhookReadOnly(f.options);
  assert.equal(r.verified,true,JSON.stringify(r));assert.ok(f.calls.some(c=>c.url==='https://events.timesaverautomate.com/health'));
  assert.ok(f.calls.filter(c=>c.url.startsWith('https://api.cloudflare.com/')).every(c=>c.options.method==='GET'));
});

test('public health disclosures, unsigned acceptance or concurrent administration cannot be reported as verified',async()=>{
  for(const [setup,code]of [[{healthExtra:true},'public_health_unverified'],[{unsignedStatus:200},'unsigned_request_unverified'],
    [{bindingChange:true},'worker_bindings_changed_during_verification']]){
    const f=fixture(setup),r=await verifyResendWebhookReadOnly(f.options);assert.equal(r.verified,false);assert.equal(r.code,code);
    assert.equal(r.cloudflareMutations,0);assert.ok(f.calls.filter(c=>c.url.startsWith('https://api.cloudflare.com/')).every(c=>c.options.method==='GET'));
  }
});

test('provider errors cannot disclose credentials or full code',async()=>{
  const f=fixture();f.options.fetcher=async()=>Response.json({success:false,errors:[{message:f.env.CLOUDFLARE_API_TOKEN}]},{status:403});
  const r=await verifyResendWebhookReadOnly(f.options);assert.equal(r.verified,false);assert.equal(r.httpStatus,403);
  assert.equal(r.cloudflareMutations,0);assert.ok(!JSON.stringify(r).includes(f.env.CLOUDFLARE_API_TOKEN));assert.ok(!JSON.stringify(r).includes(SOURCE));
});

test('hash mismatch diagnostics classify transport-only differences without accepting them or exposing code',async()=>{
  const f=fixture({remoteSource:'\uFEFF'+SOURCE.replace(/\n/g,'\r\n')+' \r\n'});
  const r=await verifyResendWebhookReadOnly(f.options);
  assert.equal(r.verified,false);assert.equal(r.installed,false);assert.equal(r.code,'published_code_hash_mismatch');
  assert.equal(r.diagnostic.kind,'source_hash_mismatch');assert.equal(r.diagnostic.diagnosticOnly,true);
  assert.match(r.diagnostic.local.sha256,/^[a-f0-9]{64}$/);assert.match(r.diagnostic.remote.sha256,/^[a-f0-9]{64}$/);
  assert.notEqual(r.diagnostic.local.sha256,r.diagnostic.remote.sha256);
  assert.equal(r.diagnostic.local.bytes,Buffer.byteLength(SOURCE));assert.equal(r.diagnostic.remote.hasBom,true);
  assert.ok(r.diagnostic.remote.crlfCount>0);assert.equal(r.diagnostic.equivalentAfter.combinedTransportNormalization,true);
  assert.equal(f.calls.some(c=>!c.url.startsWith('https://api.cloudflare.com/')),false);
  assert.ok(!JSON.stringify(r).includes(SOURCE));
});

test('source-map-only and genuine security-code changes remain mismatches with boolean correction markers',async()=>{
  const map=fixture({remoteSource:SOURCE+'\n//# sourceMappingURL=https://private-map.invalid/?private_value=not-for-output\n'});
  const mapped=await verifyResendWebhookReadOnly(map.options);
  assert.equal(mapped.verified,false);assert.equal(mapped.diagnostic.equivalentAfter.sourceMapTrailer,true);
  assert.ok(!JSON.stringify(mapped).includes('private-map'));assert.ok(!JSON.stringify(mapped).includes('not-for-output'));
  const older=SOURCE.replace('redirect:"manual", signal:AbortSignal.timeout(12000)','redirect:"follow", signal:AbortSignal.timeout(3000)');
  assert.notEqual(older,SOURCE);
  const f=fixture({remoteSource:older}),r=await verifyResendWebhookReadOnly(f.options);
  assert.equal(r.verified,false);assert.equal(r.code,'published_code_hash_mismatch');
  assert.equal(r.diagnostic.local.markers.googleRedirectManual,true);assert.equal(r.diagnostic.local.markers.googleTimeout12000,true);
  assert.equal(r.diagnostic.remote.markers.googleRedirectManual,false);assert.equal(r.diagnostic.remote.markers.googleTimeout12000,false);
  assert.equal(r.diagnostic.equivalentAfter.combinedTransportNormalization,false);
  assert.ok(f.calls.every(c=>c.options.method==='GET'));
});

test('an approved compiled digest is accepted exactly when bound to this source, configuration and pinned builder',async()=>{
  const compiled='// unit fixture compiled output\n'+SOURCE;
  const f=fixture({remoteSource:compiled});f.options.buildManifest=proofFor(compiled);f.options.buildConfig=buildConfig;
  const r=await verifyResendWebhookReadOnly(f.options);assert.equal(r.verified,true,JSON.stringify(r));
  assert.equal(r.verifiedFormat,'compiled');assert.equal(r.remoteSha256,digest(compiled));assert.equal(r.sourceSha256,digest(SOURCE));
  assert.equal(r.compiledProof.builder,'wrangler@4.160.0');assert.equal(r.compiledProof.configSha256,digest(buildConfig));
  assert.equal(r.cloudflareMutations,0);assert.ok(f.calls.filter(c=>c.url.startsWith('https://api.cloudflare.com')).every(c=>c.options.method==='GET'));
  const altered=fixture({remoteSource:compiled+'\n// unapproved change'});altered.options.buildManifest=proofFor(compiled);altered.options.buildConfig=buildConfig;
  const failed=await verifyResendWebhookReadOnly(altered.options);assert.equal(failed.verified,false);assert.equal(failed.code,'published_code_hash_mismatch');
});

test('stale source or config, unsupported builder and malformed compiled proof fail before any network',async()=>{
  const compiled='// unit fixture compiled output\n'+SOURCE;
  for(const [changes,config,source,code]of [
    [{sourceSha256:'0'.repeat(64)},buildConfig,SOURCE,'compiled_proof_source_mismatch'],
    [{},buildConfig+'# changed\n',SOURCE,'compiled_proof_config_mismatch'],
    [{builder:'wrangler@latest'},buildConfig,SOURCE,'compiled_proof_invalid'],
    [{compiledSha256:'not-a-digest'},buildConfig,SOURCE,'compiled_proof_invalid'],
    [{compiledBytes:1.5},buildConfig,SOURCE,'compiled_proof_invalid'],
    [{},buildConfig,SOURCE+'\n// new source','compiled_proof_source_mismatch']
  ]){
    const f=fixture({remoteSource:compiled});Object.assign(f.options,{buildManifest:{...proofFor(compiled),...changes},buildConfig:config,source});
    const r=await verifyResendWebhookReadOnly(f.options);assert.equal(r.verified,false);assert.equal(r.code,code);assert.equal(f.calls.length,0);
  }
});

test('checked-in build proof matches current source and configuration and records the actually reproduced pinned build',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../workers/resend-webhook.build.json',import.meta.url),'utf8'));
  const config=await readFile(new URL('../wrangler.toml',import.meta.url),'utf8');
  assert.equal(manifest.sourceSha256,digest(SOURCE));assert.equal(manifest.sourceBytes,Buffer.byteLength(SOURCE));
  assert.equal(manifest.configSha256,digest(config));assert.equal(manifest.builder,'wrangler@4.160.0');
  assert.equal(manifest.compiledBytes,18405);assert.equal(manifest.compiledSha256,'514ce85082d016a3892fbe7b41bf0a98d7dfb79b9045eb710d58543eafc26aa3');
});
