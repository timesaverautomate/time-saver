import {pathToFileURL} from 'node:url';
import {probePublicTLS} from './probe-public-tls.mjs';

const ORIGIN='https://timesaverautomate.com';

export async function ensureContactReadiness({
  fetcher=fetch,
  probeTLS=probePublicTLS,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  attempts=24
}={}){
  if(typeof fetcher!=='function'||typeof probeTLS!=='function'||typeof sleep!=='function'
    ||!Number.isInteger(attempts)||attempts<1||attempts>24){
    return {ready:false,code:'invalid_readiness_configuration'};
  }
  let apiReady=false;
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      const response=await fetcher(ORIGIN+'/api/form-status',{
        redirect:'error',headers:{Origin:ORIGIN},cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10_000)});
      const noStore=(response.headers.get('Cache-Control')||'').split(',').some(value=>value.trim().toLowerCase()==='no-store');
      const jsonType=response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()==='application/json';
      if(response.status===200&&noStore&&jsonType){
        const status=await response.json();
        apiReady=status.available===true&&status.version==='direct-email-v1'
          &&typeof status.token==='string'&&status.token.length>0&&status.token.length<=600;
        if(apiReady)break;
      }
    }catch{}
    if(attempt+1<attempts){
      try{await sleep(5000);}catch{return {ready:false,code:'contact_api_unavailable'};}
    }
  }
  if(!apiReady)return {ready:false,code:'contact_api_unavailable'};
  try{
    const tls=await probeTLS();
    if(tls?.verified!==true)return {ready:false,code:'contact_tls_unverified'};
  }catch{return {ready:false,code:'contact_tls_unverified'};}
  // Não publicar o ticket nem dados internos recebidos durante o diagnóstico.
  return {ready:true,code:'contact_publication_verified'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await ensureContactReadiness();
  console.log(JSON.stringify(result));
  if(!result.ready){
    console.error('Publicação do formulário bloqueada: a API ou a segurança TLS ainda não foram verificadas. A versão anterior mantém-se publicada.');
    process.exitCode=1;
  }else console.log('API sem cache e TLS verificados. A aceitação e a receção de email continuam a ser verificações distintas.');
}
