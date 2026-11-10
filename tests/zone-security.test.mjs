import test from 'node:test';
import assert from 'node:assert/strict';
import {hardenZoneTLS} from '../scripts/zone-security.mjs';

test('TLS mínimo antigo sobe a 1.2 e só é confirmado após nova leitura',async()=>{
  const calls=[];let version='1.0';
  const result=await hardenZoneTLS({zoneId:'a'.repeat(32),cf:async(path,options)=>{
    calls.push({path,options});if(options.method==='PATCH')version=options.body.value;
    return {value:version,editable:true};
  }});
  assert.equal(result.verified,true);assert.equal(result.changed,true);assert.equal(result.minimumVersion,'1.2');
  assert.equal(calls.length,3);assert.ok(calls.every(x=>x.path.endsWith('/settings/min_tls_version')));
});
test('TLS 1.3 existente nunca é reduzido e falta de permissões não é tratada como sucesso',async()=>{
  let writes=0;
  const current=await hardenZoneTLS({zoneId:'b'.repeat(32),cf:async(path,options)=>{if(options.method)writes++;return {value:'1.3'};}});
  assert.equal(current.verified,true);assert.equal(current.minimumVersion,'1.3');assert.equal(writes,0);
  const denied=await hardenZoneTLS({zoneId:'b'.repeat(32),cf:async()=>{throw Object.assign(Error('do-not-expose'),{httpStatus:403});}});
  assert.equal(denied.verified,false);assert.equal(denied.code,'minimum_tls_permission_unavailable');assert.doesNotMatch(JSON.stringify(denied),/do-not-expose/);
  assert.equal((await hardenZoneTLS({zoneId:'',cf:()=>{throw Error('unexpected');}})).code,'zone_id_unavailable');
});
