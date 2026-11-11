// Teste explícito de produção: apenas dados fictícios, destino fixo do formulário.
import {pathToFileURL} from 'node:url';
import {googleToken,QUOTE_SHEET_ID} from '../src/quote-sheets.mjs';

const ORIGIN='https://timesaverautomate.com';
const validReference=value=>typeof value==='string'&&/^TS-[A-F0-9]{20}$/.test(value);
const permitted=env=>env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY_ID==='1452563434'
  &&env.GITHUB_REPOSITORY==='timesaverautomate/time-saver'&&env.GITHUB_REF==='refs/heads/main';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function probeLiveQuoteConcurrency({env=process.env,fetcher=fetch,sleep=pause,uuid=()=>crypto.randomUUID(),authorize=googleToken}={}){
  if(!permitted(env))return {verified:false,code:'quote_probe_context_invalid'};
  const fail=code=>{throw Error(code);};
  try{
    const status=await fetcher(ORIGIN+'/api/form-status',{method:'GET',redirect:'error',
      headers:{Origin:ORIGIN},signal:AbortSignal.timeout(15000)});
    if(!status.ok)fail('quote_probe_unavailable');
    const info=await status.json();
    if(info.available!==true||typeof info.token!=='string'||info.token.length>600)fail('quote_probe_unavailable');
    await sleep(1800);
    const key=uuid(),body=JSON.stringify({name:'Teste interno de segurança Time Saver',email:'timesaverautomate@gmail.com',
      company:'TESTE INTERNO — concorrência e idempotência',service:'Excel',goal:'Poupar tempo',frequency:'Pontualmente',
      startingPoint:'Criar de raiz',deadline:'A definir',budget:'A definir',tools:'',specifics:'',website:'',token:info.token,
      description:'Pedido fictício da própria Time Saver para verificar chamadas simultâneas, um único registo no CRM e um único email. Não é um pedido de cliente.'});
    let posts=0;
    async function submit(){
      if(++posts>4)fail('quote_probe_request_budget');
      const response=await fetcher(ORIGIN+'/api/quote',{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
        headers:{Origin:ORIGIN,'Content-Type':'application/json','Idempotency-Key':key},body});
      let result;try{result=await response.json();}catch{fail('quote_probe_invalid_response');}
      return {status:response.status,body:result};
    }
    const simultaneous=await Promise.all([submit(),submit()]);
    const accepted=simultaneous.filter(result=>result.status===200&&result.body?.accepted===true&&validReference(result.body.reference));
    if(!accepted.length)fail('quote_probe_no_acceptance');
    const reference=accepted[0].body.reference;
    for(const result of simultaneous){
      if(result.status===200){if(result.body?.accepted!==true||result.body.reference!==reference)fail('quote_probe_reference_mismatch');}
      else if(result.status===409&&result.body?.renewKey!==true){
        await sleep(3200);const retry=await submit();
        if(retry.status!==200||retry.body?.accepted!==true||retry.body.reference!==reference)fail('quote_probe_retry_failed');
      }else fail('quote_probe_submission_failed');
    }
    const repeated=await submit();
    if(repeated.status!==200||repeated.body?.accepted!==true||repeated.body.reference!==reference)fail('quote_probe_repeat_failed');
    const access=await authorize(env,fetcher);
    const response=await fetcher('https://sheets.googleapis.com/v4/spreadsheets/'+QUOTE_SHEET_ID+'/values/'
      +encodeURIComponent("'Pedidos do Site'!A1:R10000"),{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+access}});
    if(!response.ok)fail('quote_probe_crm_read_failed');
    const values=(await response.json()).values;
    if(!Array.isArray(values))fail('quote_probe_crm_invalid_response');
    const matches=values.filter((row,index)=>index>0&&row[0]===reference);
    if(matches.length!==1)fail('quote_probe_crm_duplicate_or_missing');
    if(matches[0][4]!=='TESTE INTERNO — concorrência e idempotência'
      ||matches[0][14]!=='Novo'||!matches[0][17])fail('quote_probe_crm_confirmation_missing');
    return {verified:true,reference,simultaneousRequests:2,submissionStatuses:simultaneous.map(result=>result.status),
      totalPosts:posts,crmRows:1,repeatSameReference:true,inboxDelivery:'verify_separately',
      testRecord:'internal_test_retained',code:'quote_concurrency_verified'};
  }catch(error){
    const known=typeof error?.message==='string'&&/^quote_probe_[a-z_]+$/.test(error.message);
    return {verified:false,code:known?error.message:'quote_probe_unavailable'};
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await probeLiveQuoteConcurrency();console.log(JSON.stringify(result,null,2));
  if(result.verified!==true)process.exitCode=1;
}
