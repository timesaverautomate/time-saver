import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {buildGitHubPages} from '../scripts/build-github-pages.mjs';
import {proxyFetch} from '../src/site-proxy.mjs';
import {deploySiteDomain} from '../scripts/deploy-site-domain.mjs';

const ORIGIN='https://timesaverautomate.com';
const settings={canonicalOrigin:ORIGIN,searchIndexing:true,
  calendarUrl:'https://calendly.com/timesaverautomate/30min',whatsappNumber:'[NUMERO_WHATSAPP]'};
const routes=[['','en/'],['privacidade/','en/privacy/'],['aviso-legal/','en/legal/'],['cookies/','en/cookies/']];
const pathname=route=>route+'index.html';

test('contacto PT/EN exporta oito canonicals públicos únicos, hreflang e sitemap, mantendo a origem desativada',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'timesaver-seo-'));
  try{
    const result=await buildGitHubPages({outputDirectory:directory,publicContact:true,indexable:true,siteSettings:settings});
    assert.equal(result.indexable,false);assert.equal(result.sitemapPages,8);assert.equal(result.searchIndexingRequested,true);
    const titles=new Set(),descriptions=new Set();
    for(const pair of routes){for(const route of pair){
      const html=await readFile(path.join(directory,pathname(route)),'utf8');
      assert.match(html,new RegExp('<link rel="canonical" href="'+ORIGIN+'/'+route+'">'));
      assert.match(html,new RegExp('<link rel="alternate" hreflang="pt-PT" href="'+ORIGIN+'/'+pair[0]+'">'));
      assert.match(html,new RegExp('<link rel="alternate" hreflang="en" href="'+ORIGIN+'/'+pair[1]+'">'));
      assert.match(html,new RegExp('<link rel="alternate" hreflang="x-default" href="'+ORIGIN+'/'+pair[0]+'">'));
      assert.equal((html.match(/<title>/g)||[]).length,1);titles.add(html.match(/<title>([^<]+)<\/title>/)[1]);
      assert.equal((html.match(/<meta name="description"/g)||[]).length,1);descriptions.add(html.match(/<meta name="description" content="([^"]+)"/)[1]);
      assert.match(html,/name="robots" content="noindex,nofollow"/);
      assert.match(html,/name="time-saver-form-mode" content="disabled"/);
      assert.match(html,/name="time-saver-api-origin" content=""/);
      assert.match(html,/require-trusted-types-for 'script'/);
      assert.match(html,/property="og:image" content="https:\/\/timesaverautomate\.com\/partilha\.png"/);
      assert.match(html,/rel="icon" href="\/time-saver\/favicon\.svg"/);
      assert.match(html,/href="\/time-saver\/styles\.css"/);
      assert.match(html,route.startsWith('en/')?/<html lang="en">/:/<html lang="pt-PT">/);
      assert.doesNotMatch(html,/\[NUMERO_WHATSAPP\]|data-contact="whatsapp"/);
    }}
    assert.equal(titles.size,8);assert.equal(descriptions.size,8);
    for(const route of ['','en/']){
      const html=await readFile(path.join(directory,pathname(route)),'utf8');
      assert.match(html,/href="https:\/\/calendly\.com\/timesaverautomate\/30min" target="_blank" rel="noopener noreferrer"/);
      assert.match(html,/src="\/time-saver\/app\.js"/);
    }
    const sitemap=await readFile(path.join(directory,'sitemap.xml'),'utf8');
    assert.equal((sitemap.match(/<loc>/g)||[]).length,8);
    for(const route of routes.flat())assert.ok(sitemap.includes('<loc>'+ORIGIN+'/'+route+'</loc>'));
    assert.doesNotMatch(sitemap,/github\.io|404\.html|en-privacy\.html/);
    assert.match(await readFile(path.join(directory,'robots.txt'),'utf8'),/Disallow: \//);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('o proxy só ativa indexação no domínio público por flag explícita e preserva as proteções',async()=>{
  const html='<!doctype html><html lang="en"><head><meta name="time-saver-form-mode" content="disabled"><meta name="time-saver-form-definition" content="direct-email-v1"><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="'+ORIGIN+'/en/"><link rel="stylesheet" href="/time-saver/styles.css"></head><body>English page</body></html>';
  for(const enabled of [undefined,'false','true']){
    let upstreamURL;
    const response=await proxyFetch(new Request(ORIGIN+'/en/'),{SEARCH_INDEXING_ENABLED:enabled,HSTS_ENABLED:'true'},async url=>{
      upstreamURL=url;return new Response(html,{headers:{'Content-Type':'text/html'}});
    });
    assert.equal(response.status,200);assert.equal(upstreamURL,'https://timesaverautomate.github.io/time-saver/en/');
    assert.equal(response.headers.get('X-Robots-Tag'),enabled==='true'?'index, follow':'noindex, nofollow');
    assert.equal(response.headers.get('X-Frame-Options'),'DENY');assert.equal(response.headers.get('Strict-Transport-Security'),'max-age=31536000');
    assert.match(response.headers.get('Content-Security-Policy'),/require-trusted-types-for 'script'/);
    const body=await response.text();
    assert.match(body,enabled==='true'?/name="robots" content="index,follow"/:/name="robots" content="noindex,nofollow"/);
    assert.match(body,/name="time-saver-form-mode" content="disabled"/);
    assert.match(body,/href="\/styles\.css"/);
  }
});

test('robots, sitemap e rotas EN são explícitos; API e erros mantêm noindex',async()=>{
  const env={SEARCH_INDEXING_ENABLED:'true'};
  const robots=await proxyFetch(new Request(ORIGIN+'/robots.txt'),env,()=>{throw Error('no-upstream-needed');});
  assert.equal(robots.status,200);const rules=await robots.text();
  assert.match(rules,/Allow: \//);assert.match(rules,/Disallow: \/api\//);assert.match(rules,/Sitemap: https:\/\/timesaverautomate\.com\/sitemap\.xml/);
  const defaultRules=await proxyFetch(new Request(ORIGIN+'/robots.txt'),{},()=>{throw Error('no-upstream-needed');});
  assert.equal(await defaultRules.text(),'User-agent: *\nDisallow: /\n');
  for(const route of ['en/privacy/','en/legal/','en/cookies/','sitemap.xml']){
    let fetched;
    const response=await proxyFetch(new Request(ORIGIN+'/'+route),env,async url=>{fetched=url;return new Response('static content',{headers:{'Content-Type':route.endsWith('.xml')?'application/xml':'text/plain'}});});
    assert.equal(response.status,200);assert.equal(fetched,'https://timesaverautomate.github.io/time-saver/'+route);
  }
  for(const route of ['en/login','en/api/quote','not-a-page']){
    const response=await proxyFetch(new Request(ORIGIN+'/'+route),env,()=>{throw Error('unapproved-route');});
    assert.equal(response.status,404);assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
  }
  const api=await proxyFetch(new Request(ORIGIN+'/api/form-status'),env,()=>{throw Error('no-provider-request');});
  assert.equal(api.headers.get('X-Robots-Tag'),'noindex, nofollow');assert.equal(api.headers.get('Cache-Control'),'no-store');
});

test('endereços EN sem barra ou com index.html redirecionam para o canonical sem parâmetros',async()=>{
  for(const [input,expected] of [['/en','/en/'],['/en/index.html','/en/'],['/en/privacy','/en/privacy/'],
    ['/en/legal/index.html','/en/legal/'],['/time-saver/en/cookies','/en/cookies/']]){
    const response=await proxyFetch(new Request(ORIGIN+input+'?tracking=discard'),{SEARCH_INDEXING_ENABLED:'true'},()=>{throw Error('redirect-only');});
    assert.equal(response.status,308);assert.equal(response.headers.get('Location'),ORIGIN+expected);
  }
});

test('deploy transporta só a flag pública de indexação, sem alterar LEGAL_READY ou permissões',async()=>{
  const uploads=[];let indexed=false;
  const originHTML='<html><head><meta name="time-saver-form-mode" content="disabled"><meta name="robots" content="noindex,nofollow"></head><body>Preview</body></html>';
  const upstream=()=>new Response(originHTML,{headers:{'Content-Type':'text/html'}});
  const result=await deploySiteDomain({env:{GITHUB_REPOSITORY_ID:'1452563434',GITHUB_REPOSITORY:'timesaverautomate/time-saver',
    GITHUB_REF:'refs/heads/main',CLOUDFLARE_API_TOKEN:'unit-test-'.repeat(5),SEARCH_INDEXING_ENABLED:'true'},
    source:'// timesaverautomate.github.io\nexport default {};',attempts:1,sleep:async()=>{},fetcher:async(url,options={})=>{
      const parsed=new URL(url),pathname=parsed.pathname;
      if(parsed.hostname==='timesaverautomate.github.io')return upstream();
      if(['timesaverautomate.com','www.timesaverautomate.com'].includes(parsed.hostname))return proxyFetch(new Request(url),
        {SEARCH_INDEXING_ENABLED:String(indexed),HSTS_ENABLED:'true'},async()=>upstream());
      assert.equal(parsed.hostname,'api.cloudflare.com');
      const json=result=>Response.json({success:true,result});
      if(pathname.endsWith('/accounts'))return json([{id:'a'.repeat(32)}]);
      if(pathname.endsWith('/settings'))return json({bindings:[{type:'plain_text',name:'TIME_SAVER_REPOSITORY_ID',text:'1452563434'},
        {type:'plain_text',name:'HSTS_ENABLED',text:'true'}]});
      if(pathname.endsWith('/domains'))return json(options.method==='PUT'?{}:[{hostname:'timesaverautomate.com',service:'time-saver-edge'},
        {hostname:'www.timesaverautomate.com',service:'time-saver-edge'}]);
      if(pathname.endsWith('/subdomain'))return json({enabled:false});
      if(pathname.endsWith('/scripts/time-saver-edge')){
        const metadata=JSON.parse(await options.body.get('metadata').text());uploads.push(metadata);
        indexed=metadata.bindings.find(binding=>binding.name==='SEARCH_INDEXING_ENABLED').text==='true';return json({});
      }
      throw Error('unexpected-test-operation');
    }});
  assert.equal(result.verified,true);assert.equal(uploads.length,1);
  assert.equal(uploads[0].bindings.find(binding=>binding.name==='SEARCH_INDEXING_ENABLED').text,'true');
  assert.equal(uploads[0].bindings.some(binding=>binding.name==='LEGAL_READY'),false);
});
