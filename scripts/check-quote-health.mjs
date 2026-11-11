import {pathToFileURL} from 'node:url';
import {issueDiagnosticToken} from '../src/security.mjs';

const URL='https://timesaverautomate.com/api/quote-crm-health';
export async function checkQuoteHealth({env=process.env,fetcher=fetch}={}){
  let token;
  try{token=await issueDiagnosticToken(env);}
  catch{return {ready:false,code:'crm_health_configuration_missing'};}
  try{
    const response=await fetcher(URL,{method:'GET',redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(20000),headers:{'X-Time-Saver-Diagnostic':token}});
    if(!response.ok)return {ready:false,code:'crm_health_http_'+response.status};
    const health=await response.json();
    if(health?.ready===true)return {ready:true};
    const code=typeof health?.code==='string'&&/^sheets_[a-z0-9_]{1,80}$/.test(health.code)
      ?health.code:'crm_health_not_ready';
    return {ready:false,code};
  }catch{return {ready:false,code:'crm_health_unavailable'};}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const health=await checkQuoteHealth({env:process.env});
  console.log(JSON.stringify(health));
  if(health.ready!==true)process.exitCode=1;
}
