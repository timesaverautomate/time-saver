import {connect as tlsConnect,checkServerIdentity} from 'node:tls';

const HOSTNAME='timesaverautomate.com';
const VERSIONS=['TLSv1','TLSv1.1','TLSv1.2','TLSv1.3'];
const LEGACY=new Set(VERSIONS.slice(0,2));
const REMOTE_VERSION_ALERT='ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION';
const CERTIFICATE_CODES=new Set(['ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_SIGNATURE_FAILURE']);
const LOCAL_PROTOCOL_CODES=new Set(['ERR_SSL_NO_CIPHERS_AVAILABLE','ERR_SSL_LIBRARY_HAS_NO_CIPHERS',
  'ERR_SSL_UNSUPPORTED_PROTOCOL','ERR_SSL_NO_PROTOCOLS_AVAILABLE','ERR_TLS_PROTOCOL_VERSION_CONFLICT',
  'ERR_TLS_INVALID_PROTOCOL_VERSION']);
const SAFE_CODES=new Set([REMOTE_VERSION_ALERT,...CERTIFICATE_CODES,...LOCAL_PROTOCOL_CODES,
  'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE','ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR','ERR_SSL_WRONG_VERSION_NUMBER',
  'ECONNRESET','ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','ENOTFOUND','EAI_AGAIN']);

function failed(version,error){
  // Nunca expor mensagens OpenSSL, certificados, IPs ou propriedades arbitrárias de erros.
  const code=SAFE_CODES.has(error?.code)?error.code:'OTHER_TLS_ERROR';
  if(code===REMOTE_VERSION_ALERT)return {version,status:'rejected',reason:'remote_protocol_version_alert',code};
  return {version,status:'inconclusive',reason:CERTIFICATE_CODES.has(code)?'certificate_verification_failed'
    :LOCAL_PROTOCOL_CODES.has(code)?'local_protocol_unavailable':'handshake_not_proven',code};
}

function probeVersion(version,connect,timeoutMs){
  return new Promise(resolve=>{
    let socket,settled=false;
    const finish=result=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      try{socket?.destroy();}catch{}
      resolve(result);
    };
    const timer=setTimeout(()=>finish({version,status:'inconclusive',reason:'probe_timeout',code:'PROBE_TIMEOUT'}),timeoutMs);
    try{
      socket=connect({host:HOSTNAME,port:443,servername:HOSTNAME,rejectUnauthorized:true,
        checkServerIdentity,minVersion:version,maxVersion:version,
        // Apenas permite que o cliente de diagnóstico tente os protocolos antigos.
        // Não altera o servidor e não desativa a verificação do certificado.
        ...(LEGACY.has(version)?{ciphers:'DEFAULT:@SECLEVEL=0'}:{})});
      socket.once('secureConnect',()=>{
        try{
          if(socket.authorized!==true){
            const code=CERTIFICATE_CODES.has(socket.authorizationError)?socket.authorizationError:'CERTIFICATE_NOT_AUTHORIZED';
            finish({version,status:'inconclusive',reason:'certificate_verification_failed',code});return;
          }
          const negotiatedProtocol=socket.getProtocol();
          if(negotiatedProtocol!==version){
            finish({version,status:'inconclusive',reason:'negotiated_version_mismatch',code:'PROTOCOL_MISMATCH'});return;
          }
          finish({version,status:'available',negotiatedProtocol,authorized:true});
        }catch(error){finish(failed(version,error));}
      });
      // Mantém um handler mesmo após timeout/destroy, para erros tardios não escaparem.
      socket.on('error',error=>finish(failed(version,error)));
      socket.once('close',()=>finish({version,status:'inconclusive',reason:'connection_closed',code:'CONNECTION_CLOSED'}));
    }catch(error){finish(failed(version,error));}
  });
}

export async function probePublicTLS({connect=tlsConnect,timeoutMs=5000}={}){
  if(typeof connect!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000){
    throw new TypeError('invalid_tls_probe_configuration');
  }
  const results=await Promise.all(VERSIONS.map(version=>probeVersion(version,connect,timeoutMs)));
  const versions=(predicate)=>results.filter(predicate).map(result=>result.version);
  const legacyRejected=versions(result=>LEGACY.has(result.version)&&result.status==='rejected');
  const legacyAccepted=versions(result=>LEGACY.has(result.version)&&result.status==='available');
  const modernAvailable=versions(result=>!LEGACY.has(result.version)&&result.status==='available');
  return {hostname:HOSTNAME,port:443,certificateValidation:'required',results,legacyRejected,legacyAccepted,
    modernAvailable,inconclusive:versions(result=>result.status==='inconclusive'),
    verified:legacyRejected.length===2&&modernAvailable.length===2};
}
