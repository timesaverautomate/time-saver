import {Agent,request as httpsRequest} from 'node:https';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {issueRateProbeToken} from '../src/security.mjs';

const ORIGIN='https://timesaverautomate.com';
const POST_URL=ORIGIN+'/api/quote';
const ROBOTS_URL=ORIGIN+'/robots.txt';
const BUDGET_MS=180000;
const MAX_POSTS=15;
const MAX_GETS=5;
const USER_AGENT='Mozilla/5.0 (compatible; TimeSaverSecurityProbe/1.0; +https://timesaverautomate.com/)';

class ProbeError extends Error{constructor(code){super(code);this.code=code;}}
function contextValid(env){
  return env?.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY_ID==='1452563434'
    &&env.GITHUB_REPOSITORY==='timesaverautomate/time-saver'&&env.GITHUB_REF==='refs/heads/main'
    &&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&/^\d+$/.test(env.GITHUB_RUN_ID||'');
}
function directRunner(env){
  return !['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']
    .some(name=>typeof env[name]==='string'&&env[name].trim());
}
function nativeTransport(){
  // Um único socket IPv4 ajuda a manter o egress e a localização durante a prova.
  const agent=new Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1,timeout:120000,
    family:4,rejectUnauthorized:true,minVersion:'TLSv1.2'});
  return {
    close(){agent.destroy();},
    send({url,method,headers,body,signal}){
      if(!(method==='POST'&&url===POST_URL||method==='GET'&&url===ROBOTS_URL)){
        return Promise.reject(new ProbeError('rate_probe_target_rejected'));
      }
      return new Promise((resolve,reject)=>{
        let socket,settled=false;
        const fail=error=>{if(!settled){settled=true;reject(error);}};
        const req=httpsRequest(url,{method,headers,signal,agent,family:4,
          servername:'timesaverautomate.com',rejectUnauthorized:true,minVersion:'TLSv1.2'},response=>{
          const chunks=[];let bytes=0;
          response.on('data',chunk=>{
            bytes+=chunk.length;
            if(bytes>16384){response.destroy();req.destroy();fail(new ProbeError('rate_probe_response_too_large'));return;}
            chunks.push(chunk);
          });
          response.once('error',fail);
          response.once('end',()=>{
            if(settled)return;
            settled=true;
            resolve({status:response.statusCode,headers:new Headers(Object.entries(response.headers)
              .filter(([,value])=>value!==undefined).map(([name,value])=>[name,Array.isArray(value)?value.join(', '):value])),
              body:Buffer.concat(chunks).toString('utf8'),socket});
          });
        });
        req.once('socket',value=>{socket=value;});
        req.once('error',fail);
        if(body)req.write(body);
        req.end();
      });
    }
  };
}
const defaultSleep=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);timer.unref?.();});

export async function probeLiveRateLimit({env=process.env,transport,sleep=defaultSleep,
  clock=Date.now,mintToken=issueRateProbeToken}={}){
  const result={verified:false,code:'rate_probe_not_completed',stableSources:false,stableColos:false,
    stableSocket:false,rateLimited:false,resetVerified:false,withinConfiguredLimit:true,overshoot:false,
    statuses:[],retryAfterSeconds:[]};
  if(!contextValid(env))return {...result,code:'rate_probe_context_invalid'};
  if(!directRunner(env))return {...result,code:'rate_probe_direct_runner_required'};
  if(typeof sleep!=='function'||typeof clock!=='function'||typeof mintToken!=='function'
    ||transport!==undefined&&typeof transport!=='function')return {...result,code:'rate_probe_configuration_invalid'};
  let client;
  const session=randomUUID(),started=clock(),controller=new AbortController();
  if(!Number.isSafeInteger(started))return {...result,code:'rate_probe_clock_invalid'};
  const timer=setTimeout(()=>controller.abort(),BUDGET_MS);
  let firstSource,firstColo,firstSocket,postCount=0,getCount=0,allowedBeforeBlock=0;
  const checkBudget=()=>{
    if(controller.signal.aborted||clock()-started>=BUDGET_MS){
      controller.abort();throw new ProbeError('rate_probe_timeout');
    }
  };
  function bounded(operation){
    checkBudget();
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(new ProbeError('rate_probe_timeout'));
      controller.signal.addEventListener('abort',abort,{once:true});
      const cleanup=()=>controller.signal.removeEventListener('abort',abort);
      if(controller.signal.aborted){cleanup();abort();return;}
      Promise.resolve().then(operation).then(value=>{
        cleanup();try{checkBudget();resolve(value);}catch(error){reject(error);}
      },error=>{cleanup();reject(error);});
    });
  }
  function observeSocket(response){
    if(!response.socket){result.stableSocket=false;throw new ProbeError('rate_probe_inconclusive_socket');}
    if(firstSocket===undefined){firstSocket=response.socket;result.stableSocket=true;}
    else if(response.socket!==firstSocket){result.stableSocket=false;throw new ProbeError('rate_probe_inconclusive_socket');}
  }
  function observeSource(headers){
    const source=headers.get('X-Time-Saver-Rate-Source'),colo=headers.get('X-Time-Saver-Rate-Colo');
    if(!/^[a-f0-9]{32}$/.test(source||'')){
      result.stableSources=false;throw new ProbeError('rate_probe_diagnostics_unavailable');
    }
    if(!/^[A-Z]{3}$/.test(colo||'')){
      result.stableColos=false;throw new ProbeError('rate_probe_diagnostics_unavailable');
    }
    if(firstSource===undefined){firstSource=source;result.stableSources=true;}
    else if(source!==firstSource){result.stableSources=false;throw new ProbeError('rate_probe_inconclusive_source');}
    if(firstColo===undefined){firstColo=colo;result.stableColos=true;}
    else if(colo!==firstColo){result.stableColos=false;throw new ProbeError('rate_probe_inconclusive_colo');}
  }
  try{
    if(!transport)client=nativeTransport();
    const send=transport||client.send;
    async function request({url,method,headers,body}){
      const response=await bounded(()=>send({url,method,headers,body,
        signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])}));
      observeSocket(response);
      return {...response,headers:new Headers(response.headers)};
    }
    async function post(){
      if(++postCount>MAX_POSTS)throw new ProbeError('rate_probe_request_budget_exceeded');
      let token;
      try{token=await bounded(()=>mintToken(env,clock(),session));}
      catch(error){if(error instanceof ProbeError)throw error;throw new ProbeError('rate_probe_signature_unavailable');}
      const response=await request({url:POST_URL,method:'POST',body:'{}',headers:{
        Origin:ORIGIN,'Content-Type':'application/json','Content-Length':'2',Accept:'application/json',
        'User-Agent':USER_AGENT,'Idempotency-Key':randomUUID(),'X-Time-Saver-Rate-Probe':token}});
      const status=Number.isInteger(response.status)?response.status:0;
      result.statuses.push(status);
      if(response.headers.get('X-Time-Saver-Edge')!=='1'
        ||!(response.headers.get('Cache-Control')||'').split(',').some(value=>value.trim().toLowerCase()==='no-store')){
        throw new ProbeError('rate_probe_worker_response_unverified');
      }
      observeSource(response.headers);
      let data;
      try{data=JSON.parse(response.body);}catch{throw new ProbeError('rate_probe_response_invalid');}
      if(status===422){
        if(!data?.errors||!['name','email','description'].every(field=>typeof data.errors[field]==='string')){
          throw new ProbeError('rate_probe_invalid_data_not_rejected');
        }
      }else if(status===429){
        const retry=response.headers.get('Retry-After')||'';
        if(!/^\d{1,2}$/.test(retry)||Number(retry)<1||Number(retry)>60||typeof data?.message!=='string'){
          throw new ProbeError('rate_probe_retry_after_invalid');
        }
        result.retryAfterSeconds.push(Number(retry));
      }else throw new ProbeError('rate_probe_http_unexpected');
      return status;
    }
    for(let attempt=0;attempt<12;attempt++){
      if(attempt)await bounded(()=>sleep(2000));
      const status=await post();
      if(status===429){
        if(attempt===0)throw new ProbeError('rate_probe_initial_bucket_busy');
        result.rateLimited=true;break;
      }
      allowedBeforeBlock++;
      result.withinConfiguredLimit=allowedBeforeBlock<=5;
      result.overshoot=allowedBeforeBlock>5;
    }
    if(!result.rateLimited)throw new ProbeError('rate_probe_inconclusive_no_block');
    if(await post()!==429)throw new ProbeError('rate_probe_block_not_persistent');
    // Mantém o mesmo socket sem tocar no contador do formulário durante o reset.
    for(let remaining=65000;remaining>0;){
      const slice=Math.min(15000,remaining);await bounded(()=>sleep(slice));remaining-=slice;
      if(remaining>0){
        if(++getCount>MAX_GETS)throw new ProbeError('rate_probe_request_budget_exceeded');
        const heartbeat=await request({url:ROBOTS_URL,method:'GET',headers:{Accept:'text/plain','User-Agent':USER_AGENT}});
        if(heartbeat.status!==200||heartbeat.headers.get('X-Time-Saver-Edge')!=='1')throw new ProbeError('rate_probe_keepalive_failed');
      }
    }
    if(await post()!==422)throw new ProbeError('rate_probe_reset_not_verified');
    result.resetVerified=true;
    result.verified=result.stableSources&&result.stableColos&&result.stableSocket;
    result.code=result.verified?'rate_probe_verified':'rate_probe_inconclusive';
  }catch(error){result.code=error instanceof ProbeError?error.code:'rate_probe_network_or_runtime_error';}
  finally{clearTimeout(timer);controller.abort();client?.close();}
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await probeLiveRateLimit();
  console.log(JSON.stringify(result));
  if(!result.verified)process.exitCode=1;
}
