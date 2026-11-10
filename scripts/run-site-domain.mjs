import { appendFile } from 'node:fs/promises';
import { deploySiteDomain,readProxySource } from './deploy-site-domain.mjs';
const env=process.env;
if(env.GITHUB_REPOSITORY_ID!=='1452563434' || env.GITHUB_REPOSITORY!=='timesaverautomate/time-saver'
  || env.GITHUB_REF!=='refs/heads/main' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')
  || !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !env.GITHUB_TOKEN) {
  console.error('Execute a configuração do domínio no workflow autorizado em main.');process.exit(1);
}
async function report(state,description){
  const response=await fetch('https://api.github.com/repos/'+env.GITHUB_REPOSITORY+'/statuses/'+env.GITHUB_SHA,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),
    headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json',
      'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
    body:JSON.stringify({state,description,context:'time-saver/domain',
      target_url:'https://github.com/'+env.GITHUB_REPOSITORY+'/actions/runs/'+env.GITHUB_RUN_ID})
  });
  if(!response.ok)throw new Error('status_unavailable');
}
try{await report('pending','A ligar e verificar timesaverautomate.com com proteção Cloudflare.');}
catch{console.error('Não foi possível registar o início da configuração. Nenhum domínio foi alterado.');process.exit(1);}
let result;
try{result=await deploySiteDomain({env,source:await readProxySource()});}
catch{result={configured:false,verified:false,code:'domain_setup_failed'};}
console.log(JSON.stringify(result,null,2));
if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,
  '## Domínio Time Saver\n\nResultado: '+result.code+'\n\n'
  +'Domínio e cabeçalhos verificados: '+String(result.verified)+'\n\n'
  +'Ficheiros no GitHub Pages; domínio e proteção através do Worker time-saver-edge. '
  +'Sem formulário, dados legais inventados, backend de email ou alterações de planos.\n');
try{await report(result.verified?'success':'failure',result.verified
  ? 'Domínio, HTTPS e cabeçalhos verificados; site sem formulário.'
  : 'Configuração pendente: '+result.code+(result.httpStatus?' (HTTP '+result.httpStatus+')':''));}
catch{console.error('Não foi possível registar o resultado final.');process.exitCode=1;}
if(!result.verified)process.exitCode=1;
