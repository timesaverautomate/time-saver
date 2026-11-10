const url='https://timesaverautomate.com/api/quote-crm-health';
const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
if(!response.ok)throw Error('crm_health_http_'+response.status);
const health=await response.json();
console.log(JSON.stringify(health));
if(health.ready!==true)process.exitCode=1;
