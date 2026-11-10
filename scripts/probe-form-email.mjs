const env=process.env;
if(env.GITHUB_REPOSITORY_ID!=='1452563434'||env.GITHUB_REPOSITORY!=='timesaverautomate/time-saver'
  ||env.GITHUB_REF!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')
  ||!/^\d+$/.test(env.GITHUB_RUN_ID||'')||!env.GITHUB_TOKEN)process.exit(1);
async function report(state,description){
  const response=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+'/statuses/'+env.GITHUB_SHA,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),
    headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},
    body:JSON.stringify({state,description,context:'time-saver/form-email',
      target_url:'https://github.com/'+env.GITHUB_REPOSITORY+'/actions/runs/'+env.GITHUB_RUN_ID})});
  if(!response.ok)throw Error('status_failed');
}
try{await report('pending','A verificar remetente real e acesso de configuração do email.');}
catch{console.error('Não foi possível iniciar o diagnóstico.');process.exit(1);}
const result={senderAccepted:false,domainReadable:false,dnsReadable:false};
const key=env.RESEND_DOMAIN_API_KEY||env.RESEND_API_KEY||'';
try{
  if(!/^re_[A-Za-z0-9_-]{8,256}$/.test(key))throw Error('missing_resend_key');
  const headers={Authorization:'Bearer '+key,'Content-Type':'application/json'};
  const domains=await fetch('https://api.resend.com/domains',{headers,redirect:'error',signal:AbortSignal.timeout(15_000)});
  result.domainHttpStatus=domains.status;result.domainReadable=domains.ok;
  if(domains.ok){const data=await domains.json();result.domainStatus=data.data?.find(d=>d.name==='timesaverautomate.com')?.status||'not_configured';}
  await new Promise(resolve=>setTimeout(resolve,650));
  const day=new Date().toISOString().slice(0,10);
  const sent=await fetch('https://api.resend.com/emails',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
    headers:{...headers,'Idempotency-Key':'time-saver-form-sender-'+day},
    body:JSON.stringify({from:'Time Saver <pedidos@timesaverautomate.com>',to:['timesaverautomate@gmail.com'],
      subject:'Time Saver — Teste do remetente do formulário',
      text:'Teste técnico do remetente do formulário Time Saver.\nData UTC: '+day+'\nSem dados de clientes.\nEste teste não ativa o formulário.'})
  });
  result.sendHttpStatus=sent.status;
  const body=await sent.json().catch(()=>({}));
  result.senderAccepted=sent.ok&&typeof body.id==='string';
  if(result.senderAccepted)result.testEmailId=body.id;
  else result.senderCode=/domain.*(?:not verified|unverified)/i.test(body.message||'')?'sender_domain_not_verified'
    : sent.status===403?'sender_permission_denied':sent.status===401?'invalid_resend_credential':'sender_not_confirmed';
  const token=env.CLOUDFLARE_API_TOKEN;
  if(token){
    async function cf(path){const r=await fetch('https://api.cloudflare.com/client/v4'+path,{
      headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15_000)});
      return {status:r.status,data:r.ok?(await r.json()).result:null};}
    let account=env.CLOUDFLARE_ACCOUNT_ID||'';
    if(!account){const a=await cf('/accounts?per_page=50');if(a.data?.length===1)account=a.data[0].id;}
    if(/^[a-f0-9]{32}$/i.test(account)){
      const domains=await cf('/accounts/'+account+'/workers/domains');
      const zone=domains.data?.find(d=>d.hostname==='timesaverautomate.com')?.zone_id;
      if(/^[a-f0-9]{32}$/i.test(zone||'')){
        const dns=await cf('/zones/'+zone+'/dns_records?type=TXT&name=resend._domainkey.timesaverautomate.com');
        result.dnsHttpStatus=dns.status;result.dnsReadable=dns.status===200;
      }
    }
  }
}catch{result.code='email_setup_probe_incomplete';}
console.log(JSON.stringify(result,null,2));
try{await report(result.senderAccepted?'success':'failure',result.senderAccepted
  ?'Remetente de produção aceite; receção e formulário ainda por validar.'
  :'Email pendente: '+(result.senderCode||result.code||'consultar diagnóstico')+'.');}
catch{console.error('Não foi possível registar o resultado.');process.exitCode=1;}
if(!result.senderAccepted)process.exitCode=1;
