import { appendFile,readFile } from 'node:fs/promises';
import { deploySiteDomain,readSiteModules } from './deploy-site-domain.mjs';
import { probePublicTLS } from './probe-public-tls.mjs';
const env=process.env;
if(env.GITHUB_REPOSITORY_ID!=='1452563434' || env.GITHUB_REPOSITORY!=='timesaverautomate/time-saver'
  || env.GITHUB_REF!=='refs/heads/main' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')
  || !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !env.GITHUB_TOKEN) {
  console.error('Execute a configuração do domínio no workflow autorizado em main.');process.exit(1);
}
async function report(state,description,context='time-saver/domain'){
  const response=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+'/statuses/'+env.GITHUB_SHA,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),
    headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json',
      'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
    body:JSON.stringify({state,description,context,
      target_url:'https://github.com/'+env.GITHUB_REPOSITORY+'/actions/runs/'+env.GITHUB_RUN_ID})
  });
  if(!response.ok)throw new Error('status_unavailable');
}
try{await report('pending','A ligar e verificar timesaverautomate.com com proteção Cloudflare.');}
catch{console.error('Não foi possível registar o início da configuração. Nenhum domínio foi alterado.');process.exit(1);}
let result;
try{
  const modules=await readSiteModules();
  const config=JSON.parse(await readFile(new URL('../config/domain.json',import.meta.url),'utf8'));
  result=await deploySiteDomain({env:{...env,FORM_ENABLED:config.quoteCollectionEnabled===true?'true':'false'},
    source:modules['proxy.mjs'],modules,mask:value=>console.log('::add-mask::'+value)});
}
catch{result={configured:false,verified:false,code:'domain_setup_failed'};}
if(result.verified){
  try{result.transportTLS=await probePublicTLS();}
  catch{result.transportTLS={verified:false,code:'public_tls_probe_unavailable'};}
}
console.log(JSON.stringify(result,null,2));
if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,
  '## Domínio Time Saver\n\nResultado: '+result.code+'\n\n'
  +'Domínio e cabeçalhos verificados: '+String(result.verified)+'\n\n'
  +'TLS 1.0/1.1 recusados e TLS 1.2/1.3 disponíveis no handshake: '+String(result.transportTLS?.verified===true)+'\n\n'
  +'Ficheiros no GitHub Pages; domínio e proteção através do Worker time-saver-edge. '
  +'Envio direto sem base de dados de pedidos. A disponibilidade da API não substitui o teste real do formulário e da receção. Sem alterações de planos.\n');
try{await report(result.verified?'success':'failure',result.verified
  ? (result.contactApiConfigured?'Domínio protegido e API de email disponível; sem base de dados.':'Domínio, HTTPS e cabeçalhos verificados; site sem formulário.')
  : 'Configuração pendente: '+result.code+(result.httpStatus?' (HTTP '+result.httpStatus+')':''));}
catch{console.error('Não foi possível registar o resultado final.');process.exitCode=1;}
if(result.verified){
  try{await report(result.transportTLS?.verified?'success':'failure',result.transportTLS?.verified
    ?'Handshake: TLS 1.0/1.1 recusados; TLS 1.2/1.3 verificados.'
    :'TLS mínimo precisa de verificação ou ajuste na Cloudflare; consultar resultado.',
    'time-saver/transport-tls');}
  catch{console.error('Não foi possível registar a verificação de TLS.');process.exitCode=1;}
}
if(!result.verified)process.exitCode=1;
