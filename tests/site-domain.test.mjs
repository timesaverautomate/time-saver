import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { proxyFetch } from '../src/site-proxy.mjs';
import { deploySiteDomain,readProxySource } from '../scripts/deploy-site-domain.mjs';
const DOMAIN='timesaverautomate.com';
const originHTML='<!doctype html><html><head><meta name="time-saver-form-mode" content="disabled"><link rel="canonical" href="https://timesaverautomate.github.io/time-saver/"><link rel="stylesheet" href="/time-saver/styles.css"></head><body><main id="conteudo">Time Saver · Pré-lançamento</main></body></html>';
const upstream=()=>new Response(originHTML,{headers:{'Content-Type':'text/html; charset=utf-8'}});

test('proxy do domínio reescreve caminhos e metadados e aplica cabeçalhos sem cookies',async()=>{
  let forwarded;
  const response=await proxyFetch(new Request('https://'+DOMAIN+'/',{headers:{
    Authorization:'test-header',Cookie:'test-cookie',Origin:'https://external.test','X-Forwarded-For':'192.0.2.1'
  }}),{HSTS_ENABLED:'true'},async(url,options)=>{
    forwarded={url,options};return new Response(originHTML,{headers:{
      'Content-Type':'text/html','Set-Cookie':'not-to-forward=test','Access-Control-Allow-Origin':'*',ETag:'old'
    }});
  });
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html,/href="https:\/\/timesaverautomate\.com\/"/);
  assert.match(html,/href="\/styles.css"/);
  assert.doesNotMatch(html,/github\.io|\/time-saver\//);
  assert.equal(forwarded.url,'https://timesaverautomate.github.io/time-saver/');
  assert.deepEqual(Object.keys(forwarded.options.headers),['Accept']);
  assert.equal(forwarded.options.redirect,'manual');
  assert.equal(response.headers.get('X-Frame-Options'),'DENY');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(response.headers.get('Strict-Transport-Security'),'max-age=31536000');
  assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'none';.*form-action 'none'; frame-ancestors 'none'/);
  for(const name of ['Set-Cookie','Access-Control-Allow-Origin','ETag'])assert.equal(response.headers.has(name),false);
});
test('proxy só aceita hosts e recursos previstos, sem contas e sem POST para páginas',async()=>{
  let count=0;const fetcher=async()=>{count++;return upstream();};
  for(const path of ['/api/unknown','/login','/admin','/https://evil.test/','/README.md']) {
    assert.equal((await proxyFetch(new Request('https://'+DOMAIN+path),{},fetcher)).status,404);
  }
  assert.equal((await proxyFetch(new Request('https://evil.test/'),{},fetcher)).status,404);
  assert.equal((await proxyFetch(new Request('https://'+DOMAIN+'/',{method:'POST',body:'private'}),{},fetcher)).status,405);
  assert.equal((await proxyFetch(new Request('https://'+DOMAIN+'/api/quote'),{},fetcher)).status,405);
  assert.equal(count,0);
});
test('proxy encaminha HTTP/www para HTTPS canónico e remove parâmetros sem os enviar à origem',async()=>{
  for(const url of ['http://'+DOMAIN+'/', 'https://www.'+DOMAIN+'/',
    'https://'+DOMAIN+'/?email=example%40test.invalid','https://'+DOMAIN+'/time-saver/styles.css']) {
    const response=await proxyFetch(new Request(url),{},()=>{throw Error('unexpected_fetch');});
    assert.equal(response.status,308);
    const location=new URL(response.headers.get('Location'));
    assert.equal(location.protocol,'https:');assert.equal(location.hostname,DOMAIN);assert.equal(location.search,'');
    assert.equal(response.headers.has('Strict-Transport-Security'),false);
  }
});
test('proxy preserva PNG, responde a HEAD e bloqueia TLS antigo',async()=>{
  const png=await readFile(new URL('../public/partilha.png',import.meta.url));
  const response=await proxyFetch(new Request('https://'+DOMAIN+'/partilha.png'),{},async()=>
    new Response(png,{headers:{'Content-Type':'image/png'}}));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  const head=await proxyFetch(new Request('https://'+DOMAIN+'/',{method:'HEAD'}),{},async()=>upstream());
  assert.equal(await head.text(),'');
  const oldTLS=new Request('https://'+DOMAIN+'/');Object.defineProperty(oldTLS,'cf',{value:{tlsVersion:'TLSv1.1'}});
  assert.equal((await proxyFetch(oldTLS,{},()=>{throw Error('unexpected_fetch');})).status,426);
});
test('proxy falha de forma fechada se a origem passar a incluir formulário ou devolver erros',async()=>{
  for(const fetcher of [async()=>new Response(originHTML+'<form></form>',{headers:{'Content-Type':'text/html'}}),
    async()=>new Response('failure',{status:500}),
    async()=>new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}}),
    async()=>{throw Error('internal-secret-not-for-public');}]) {
    const response=await proxyFetch(new Request('https://'+DOMAIN+'/'),{},fetcher);
    assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.doesNotMatch(await response.text(),/internal-secret|github\.io/);
  }
});

function deploymentFixture({settings=null,domains=[],dnsOccupied=false,certPending=false,rejectWWW=false,contact=false,invalidRateSettings=false}={}) {
  const calls=[],uploads=[];let hsts=false;
  const env={GITHUB_REPOSITORY_ID:'1452563434',GITHUB_REPOSITORY:'timesaverautomate/time-saver',
    GITHUB_REF:'refs/heads/main',CLOUDFLARE_API_TOKEN:'unit-test-'.repeat(5)};
  if(contact)Object.assign(env,{FORM_ENABLED:'true',RESEND_API_KEY:'re_test_only_deployment'});
  const json=result=>Response.json({success:true,result});
  const fetcher=async(url,options={})=>{
    calls.push({url,options});const parsed=new URL(url),path=parsed.pathname;
    if(parsed.hostname==='dns.google')return Response.json({Status:0,Answer:dnsOccupied?[{type:1,data:'192.0.2.1'}]:[]});
    if(parsed.hostname==='timesaverautomate.github.io')return upstream();
    if([DOMAIN,'www.'+DOMAIN].includes(parsed.hostname)) {
      if(certPending)throw Error('certificate_pending');
      if(contact&&path==='/api/form-status'){
        const base=await proxyFetch(new Request('https://'+DOMAIN+'/'),{HSTS_ENABLED:String(hsts)},async()=>upstream());
        const headers=new Headers(base.headers);headers.set('Cache-Control','no-store');
        return Response.json({available:true,version:'direct-email-v1'},{headers});
      }
      return proxyFetch(new Request(url),{HSTS_ENABLED:String(hsts)},async()=>upstream());
    }
    assert.equal(parsed.hostname,'api.cloudflare.com');
    if(path.endsWith('/accounts'))return json([{id:'a'.repeat(32)}]);
    if(path.endsWith('/settings')){
      if(uploads.length){
        const bindings=structuredClone(uploads.at(-1).bindings);
        if(invalidRateSettings){const rate=bindings.find(binding=>binding.name==='FORM_IP_RATE');if(rate)rate.simple.limit=500;}
        return json({bindings});
      }
      return settings?json(settings):new Response('',{status:404});
    }
    if(path.endsWith('/domains')) {
      if(options.method==='PUT') {
        const data=JSON.parse(options.body);
        if(rejectWWW&&data.hostname.startsWith('www.'))return Response.json({success:false},{status:403});
        return json({...data,id:'d'.repeat(32)});
      }
      return json(domains);
    }
    if(path.endsWith('/subdomain'))return json({enabled:false,previews_enabled:false});
    if(path.endsWith('/scripts/time-saver-edge')) {
      const metadata=JSON.parse(await options.body.get('metadata').text());uploads.push(metadata);
      hsts=metadata.bindings.find(b=>b.name==='HSTS_ENABLED').text==='true';return json({id:'time-saver-edge'});
    }
    throw Error('unhandled_fixture_request');
  };
  return {env,calls,uploads,options:{env,source:'// timesaverautomate.github.io\nexport default {};',fetcher,attempts:1,sleep:async()=>{}}};
}
test('instalação do domínio não contacta fornecedores sem credencial ou fora do destino autorizado',async()=>{
  for(const changed of [{CLOUDFLARE_API_TOKEN:''},{GITHUB_REF:'refs/heads/other'},{GITHUB_REPOSITORY_ID:'2'}]) {
    const f=deploymentFixture();Object.assign(f.env,changed);
    assert.equal((await deploySiteDomain(f.options)).configured,false);assert.equal(f.calls.length,0);
  }
});
test('domínio usa apenas Worker e domínios personalizados, sem D1, credenciais no Worker ou mudanças de planos',async()=>{
  const f=deploymentFixture();const result=await deploySiteDomain(f.options);
  assert.equal(result.verified,true);assert.deepEqual(result.attached,[DOMAIN,'www.'+DOMAIN]);
  assert.equal(f.uploads.length,2);
  assert.equal(f.uploads[0].bindings.find(b=>b.name==='HSTS_ENABLED').text,'false');
  assert.equal(f.uploads[1].bindings.find(b=>b.name==='HSTS_ENABLED').text,'true');
  assert.equal(f.uploads[0].observability.enabled,false);
  assert.ok(f.uploads.every(m=>!JSON.stringify(m).includes(f.env.CLOUDFLARE_API_TOKEN)));
  assert.ok(f.calls.every(c=>!/subscriptions|billing|d1\/database|dns_records/.test(c.url)));
  const attached=f.calls.filter(c=>c.url.endsWith('/domains')&&c.options.method==='PUT').map(c=>JSON.parse(c.options.body));
  assert.ok(attached.every(d=>d.service==='time-saver-edge'&&d.zone_name===DOMAIN&&d.previews_enabled===false));
});
test('domínio recusa substituir Worker alheio, outro serviço ou DNS já ocupado',async()=>{
  for(const setup of [{settings:{bindings:[]}},{domains:[{hostname:DOMAIN,service:'other-worker'}]},{dnsOccupied:true}]) {
    const f=deploymentFixture(setup);const result=await deploySiteDomain(f.options);
    assert.equal(result.installed,false);assert.equal(f.calls.filter(c=>c.options.method==='PUT').length,0);
  }
});
test('envio direto instala apenas módulos, segredos e contadores, preservando a chave existente sem D1',async()=>{
  const settings={bindings:[{type:'plain_text',name:'TIME_SAVER_REPOSITORY_ID',text:'1452563434'},
    {type:'secret_text',name:'SECURITY_HMAC_KEY'},{type:'plain_text',name:'HSTS_ENABLED',text:'true'}]};
  const f=deploymentFixture({settings,contact:true});
  const result=await deploySiteDomain(f.options);assert.equal(result.contactApiConfigured,true);
  const metadata=f.uploads[0];assert.deepEqual(metadata.keep_bindings,['secret_text']);
  assert.equal(metadata.bindings.filter(b=>b.type==='ratelimit').length,3);
  assert.equal(metadata.bindings.find(b=>b.name==='RESEND_API_KEY').type,'secret_text');
  assert.equal(metadata.bindings.some(b=>b.name==='SECURITY_HMAC_KEY'),false);
  assert.ok(metadata.bindings.every(b=>!['d1','kv_namespace','durable_object_namespace','queue'].includes(b.type)));
  assert.ok(f.calls.every(c=>!/billing|subscriptions|d1\/database/.test(c.url)));
});
test('publicação confirma contadores reais na Cloudflare e recusa configuração divergente',async()=>{
  const settings={bindings:[{type:'plain_text',name:'TIME_SAVER_REPOSITORY_ID',text:'1452563434'},
    {type:'secret_text',name:'SECURITY_HMAC_KEY'},{type:'plain_text',name:'HSTS_ENABLED',text:'true'}]};
  const good=deploymentFixture({settings,contact:true});const accepted=await deploySiteDomain(good.options);
  assert.equal(accepted.rateLimits.verified,true);assert.equal(accepted.rateLimits.bindings.length,3);
  assert.equal(accepted.rateLimits.bindings.find(binding=>binding.name==='FORM_IP_RATE').limit,5);
  const bad=deploymentFixture({settings,contact:true,invalidRateSettings:true});const rejected=await deploySiteDomain(bad.options);
  assert.equal(rejected.verified,false);assert.equal(rejected.code,'rate_limit_settings_unverified');
  assert.equal(bad.calls.some(call=>call.url.endsWith('/domains')&&call.options.method==='PUT'),false);
});
test('HSTS só é ativado após verificar HTTPS; certificado pendente ou www recusado nunca são sucesso',async()=>{
  const pending=deploymentFixture({certPending:true});
  const result=await deploySiteDomain(pending.options);
  assert.equal(result.configured,true);assert.equal(result.verified,false);assert.equal(result.code,'dns_or_certificate_pending');
  assert.equal(pending.uploads.length,1);
  const partial=deploymentFixture({rejectWWW:true});const rejected=await deploySiteDomain(partial.options);
  assert.equal(rejected.verified,false);assert.deepEqual(rejected.attached,[DOMAIN]);assert.equal(rejected.httpStatus,403);
});
test('falhas da Cloudflare não revelam valores ou mensagens internas e o módulo real está disponível',async()=>{
  const f=deploymentFixture();f.options.fetcher=async()=>Response.json({success:false,errors:[{message:f.env.CLOUDFLARE_API_TOKEN}]},{status:401});
  const result=await deploySiteDomain(f.options);
  assert.equal(result.httpStatus,401);assert.equal(result.operation,'account_discovery');
  assert.ok(!JSON.stringify(result).includes(f.env.CLOUDFLARE_API_TOKEN));
  assert.match(await readProxySource(),/timesaverautomate\.github\.io/);
});
