// Configuração limitada ao TLS do domínio já associado ao Worker deste projeto.
export async function hardenZoneTLS({zoneId,cf}){
  if(!/^[a-f0-9]{32}$/i.test(zoneId||''))return {verified:false,changed:false,code:'zone_id_unavailable'};
  const endpoint='/zones/'+zoneId+'/settings/min_tls_version';
  let changed=false;
  try{
    let setting=await cf(endpoint,{operation:'minimum_tls_read'});
    if(!['1.0','1.1','1.2','1.3'].includes(setting?.value))return {verified:false,changed,code:'minimum_tls_unknown'};
    if(['1.0','1.1'].includes(setting.value)){
      if(setting.editable===false)return {verified:false,changed,code:'minimum_tls_not_editable'};
      await cf(endpoint,{method:'PATCH',body:{value:'1.2'},operation:'minimum_tls_update'});
      changed=true;
      setting=await cf(endpoint,{operation:'minimum_tls_verify'});
    }
    const verified=['1.2','1.3'].includes(setting?.value);
    return {verified,changed,...(verified?{minimumVersion:setting.value}:{}),code:verified?'minimum_tls_verified':'minimum_tls_not_confirmed'};
  }catch(error){
    return {verified:false,changed,code:[401,403].includes(error?.httpStatus)?'minimum_tls_permission_unavailable':'minimum_tls_check_unavailable',
      ...([401,403].includes(error?.httpStatus)?{httpStatus:error.httpStatus}:{})};
  }
}
