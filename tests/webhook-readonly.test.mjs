import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyResendWebhookReadOnly} from '../scripts/verify-resend-webhook-readonly.mjs';
const SOURCE=await readFile(new URL('../workers/resend-webhook.js',import.meta.url),'utf8');
const ACCOUNT='a'.repeat(32),WORKER='timesaver-resend-webhook';
const ORIGIN='https://'+WORKER+'.time-saver-fixture.workers.dev';
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
