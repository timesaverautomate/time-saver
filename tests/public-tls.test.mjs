import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {probePublicTLS} from '../scripts/probe-public-tls.mjs';

const LEGACY=['TLSv1','TLSv1.1'];
const remoteAlert=()=>Object.assign(new Error('details-not-to-log'),{code:'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION'});
function connector(behaviour){
  const options=[],sockets=[];
  const connect=config=>{
    options.push(config);
    const socket=new EventEmitter();socket.destroyed=false;
    socket.destroy=()=>{socket.destroyed=true;};socket.authorized=true;socket.getProtocol=()=>config.minVersion;
    sockets.push(socket);queueMicrotask(()=>behaviour(config,socket));return socket;
  };
  return {connect,options,sockets};
}
function expected(config,socket){
  if(LEGACY.includes(config.minVersion))socket.emit('error',remoteAlert());
  else socket.emit('secureConnect');
}

test('probe usa SNI, certificado obrigatório e versões exatas; enfraquecimento de cifras só no diagnóstico legado',async()=>{
  const f=connector(expected),result=await probePublicTLS({connect:f.connect});
  assert.equal(result.verified,true);assert.deepEqual(result.legacyRejected,LEGACY);
  assert.deepEqual(result.modernAvailable,['TLSv1.2','TLSv1.3']);assert.deepEqual(result.inconclusive,[]);
  for(const options of f.options){
    assert.equal(options.host,'timesaverautomate.com');assert.equal(options.port,443);
    assert.equal(options.servername,'timesaverautomate.com');assert.equal(options.rejectUnauthorized,true);
    assert.equal(options.minVersion,options.maxVersion);
    assert.equal(options.ciphers,LEGACY.includes(options.minVersion)?'DEFAULT:@SECLEVEL=0':undefined);
    const mismatch=options.checkServerIdentity('timesaverautomate.com',{subject:{CN:'invalid.example'},subjectaltname:'DNS:invalid.example'});
    assert.equal(mismatch.code,'ERR_TLS_CERT_ALTNAME_INVALID');
  }
  assert.ok(f.sockets.every(socket=>socket.destroyed));
  assert.equal(JSON.stringify(result).includes('details-not-to-log'),false);
});

test('erro de handshake ou de cifras não prova que o servidor rejeitou TLS antigo',async()=>{
  const f=connector((config,socket)=>{
    if(config.minVersion==='TLSv1')socket.emit('error',{code:'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE'});
    else if(config.minVersion==='TLSv1.1')socket.emit('error',{code:'ERR_SSL_NO_CIPHERS_AVAILABLE'});
    else socket.emit('secureConnect');
  });
  const result=await probePublicTLS({connect:f.connect});
  assert.equal(result.verified,false);assert.deepEqual(result.legacyRejected,[]);assert.deepEqual(result.inconclusive,LEGACY);
  assert.equal(result.results[1].reason,'local_protocol_unavailable');
});

test('falha de CA ou certificado não autorizado impede declarar TLS moderno disponível',async()=>{
  const f=connector((config,socket)=>{
    if(LEGACY.includes(config.minVersion))socket.emit('error',remoteAlert());
    else if(config.minVersion==='TLSv1.2')socket.emit('error',{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE',message:'private CA details'});
    else{socket.authorized=false;socket.authorizationError='CERT_HAS_EXPIRED';socket.emit('secureConnect');}
  });
  const result=await probePublicTLS({connect:f.connect});
  assert.equal(result.verified,false);assert.deepEqual(result.modernAvailable,[]);
  assert.deepEqual(result.inconclusive,['TLSv1.2','TLSv1.3']);
  assert.ok(result.results.slice(2).every(item=>item.reason==='certificate_verification_failed'));
  assert.equal(JSON.stringify(result).includes('private CA details'),false);
});

test('negociação de TLS legado é sinalizada como aceite e impede resultado agregado verificado',async()=>{
  const f=connector((_config,socket)=>socket.emit('secureConnect'));
  const result=await probePublicTLS({connect:f.connect});
  assert.equal(result.verified,false);assert.deepEqual(result.legacyAccepted,LEGACY);
  assert.deepEqual(result.legacyRejected,[]);assert.deepEqual(result.modernAvailable,['TLSv1.2','TLSv1.3']);
});

test('timeout e fecho antecipado são inconclusivos e todos os sockets são fechados',async()=>{
  const f=connector((config,socket)=>{
    if(config.minVersion==='TLSv1')return;
    if(config.minVersion==='TLSv1.1')socket.emit('close');else socket.emit('secureConnect');
  });
  const result=await probePublicTLS({connect:f.connect,timeoutMs:10});
  assert.deepEqual(result.inconclusive,LEGACY);assert.equal(result.results[0].code,'PROBE_TIMEOUT');
  assert.equal(result.results[1].code,'CONNECTION_CLOSED');assert.ok(f.sockets.every(socket=>socket.destroyed));
  assert.doesNotThrow(()=>f.sockets[0].emit('error',new Error('late private error')));
});

test('versão negociada diferente e erros arbitrários nunca viram evidência ou dados públicos',async()=>{
  const f=connector((config,socket)=>{
    if(config.minVersion==='TLSv1')socket.emit('error',{code:'unexpected-private-code',message:'private-message'});
    else if(config.minVersion==='TLSv1.1')socket.emit('error',remoteAlert());
    else{socket.getProtocol=()=>null;socket.emit('secureConnect');}
  });
  const result=await probePublicTLS({connect:f.connect});
  assert.equal(result.verified,false);assert.deepEqual(result.legacyRejected,['TLSv1.1']);
  assert.deepEqual(result.modernAvailable,[]);assert.equal(result.results[0].code,'OTHER_TLS_ERROR');
  assert.equal(result.results[2].code,'PROTOCOL_MISMATCH');assert.doesNotMatch(JSON.stringify(result),/private/);
});

test('erro local síncrono não é rejeição remota e configuração inválida falha sem conectar',async()=>{
  const result=await probePublicTLS({connect:()=>{throw {code:'ERR_SSL_UNSUPPORTED_PROTOCOL'};}});
  assert.equal(result.verified,false);assert.equal(result.inconclusive.length,4);assert.deepEqual(result.legacyRejected,[]);
  let calls=0;
  await assert.rejects(probePublicTLS({connect:()=>{calls++;},timeoutMs:0}),/invalid_tls_probe_configuration/);
  assert.equal(calls,0);
});
