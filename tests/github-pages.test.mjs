import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildGitHubPages } from '../scripts/build-github-pages.mjs';
import { spawnSync } from 'node:child_process';

test('exportação Pages resolve recursos e páginas no subdiretório do projeto',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'time-saver-pages-'));
  try {
    const output=path.join(directory,'out');
    const result=await buildGitHubPages({outputDirectory:output});
    assert.equal(result.expectedURL,'https://timesaverautomate.github.io/time-saver/');
    for (const file of ['index.html','404.html','privacidade/index.html','cookies/index.html','aviso-legal/index.html','app.js','styles.css','logo.svg','partilha.png','.nojekyll']) await access(path.join(output,file));
    for (const page of ['index.html','404.html','privacidade/index.html','cookies/index.html','aviso-legal/index.html']) {
      const html=await readFile(path.join(output,page),'utf8');
      for (const match of html.matchAll(/\b(?:href|src)="(\/[^"]*)"/g)) assert.ok(match[1].startsWith('/time-saver/'),match[1]);
      assert.match(html,/time-saver-form-mode" content="disabled"/);
      assert.match(html,/name="robots" content="noindex,nofollow"/);
      assert.match(html,/Content-Security-Policy/);
      assert.equal(/RESEND_API_KEY|SECURITY_HMAC_KEY|Bearer /.test(html),false);
    }
    const home=await readFile(path.join(output,'index.html'),'utf8');
    assert.match(home,/href="\/time-saver\/privacidade\/"/);
    assert.match(home,/content="https:\/\/timesaverautomate\.github\.io\/time-saver\/partilha\.png"/);
    assert.match(home,/envio de pedidos está temporariamente desativado/);
    assert.match(await readFile(path.join(output,'robots.txt'),'utf8'),/Disallow: \//);
    assert.deepEqual(await readFile(path.join(output,'partilha.png')),await readFile(new URL('../public/partilha.png',import.meta.url)));
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('pré-lançamento público mantém o design e exclui formulários, marcadores e chamadas à API',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'time-saver-public-preview-'));
  const original=await readFile(new URL('../public/privacidade.html',import.meta.url),'utf8');
  try {
    const output=path.join(directory,'out');
    const result=await buildGitHubPages({outputDirectory:output,publicPreview:true,indexable:true,apiOrigin:'https://api.test'});
    assert.equal(result.indexable,false);
    assert.equal(result.backendConfigured,false);
    const home=await readFile(path.join(output,'index.html'),'utf8');
    assert.match(home,/pré-lançamento/i);
    assert.match(home,/id="servicos"/);
    assert.match(home,/id="possibilidades"/);
    assert.match(home,/id="orcamento"/);
    for (const page of ['index.html','404.html','privacidade/index.html','aviso-legal/index.html','cookies/index.html']) {
      const html=await readFile(path.join(output,page),'utf8');
      assert.doesNotMatch(html,/<(?:form|input|textarea|select)\b/i);
      assert.doesNotMatch(html,/\[[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ][^\]]+\]/);
      assert.match(html,/time-saver-form-mode" content="disabled"/);
      assert.match(html,/time-saver-api-origin" content=""/);
      assert.match(html,/name="robots" content="noindex,nofollow"/);
      assert.doesNotMatch(html,/https:\/\/api\.test/);
    }
    assert.equal(await readFile(new URL('../public/privacidade.html',import.meta.url),'utf8'),original);
    assert.match(original,/\[DENOMINAÇÃO LEGAL\]/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('publicação comercial continua bloqueada pelos dados legais; pré-lançamento é um modo explícito',()=>{
  const script=new URL('../scripts/prepare-publication.mjs',import.meta.url);
  const preview=spawnSync(process.execPath,[script.pathname],{env:{...process.env,REQUESTED_PUBLICATION:'preview'},encoding:'utf8'});
  assert.equal(preview.status,0);
  const production=spawnSync(process.execPath,[script.pathname],{env:{...process.env,REQUESTED_PUBLICATION:'production'},encoding:'utf8'});
  assert.notEqual(production.status,0);
  assert.match(production.stderr,/Publicação comercial bloqueada/);
});
test('exportação Pages admite raiz e impede origens ou caminhos inválidos',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'time-saver-pages-root-'));
  try {
    const output=path.join(directory,'out');
    await buildGitHubPages({outputDirectory:output,basePath:'/',indexable:true});
    const html=await readFile(path.join(output,'index.html'),'utf8');
    assert.match(html,/href="\/privacidade\/"/);
    assert.match(html,/name="robots" content="index,follow"/);
    for (const options of [{basePath:'/../'},{basePath:'/./'},{origin:'http://inseguro.test'},{origin:'https://exemplo.test/caminho'}]) {
      await assert.rejects(buildGitHubPages({outputDirectory:output,...options}));
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('modo de contacto inclui triagem e informação real, mantendo o envio desligado na origem GitHub',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'time-saver-contact-'));
  try{
    await buildGitHubPages({outputDirectory:directory,publicContact:true});
    const home=await readFile(path.join(directory,'index.html'),'utf8');
    assert.match(home,/time-saver-form-definition" content="direct-email-v1/);
    assert.match(home,/time-saver-form-mode" content="disabled/);
    assert.equal((home.match(/type="checkbox" name="service"/g)||[]).length,7);
    assert.match(home,/id="goal"/);assert.match(home,/id="frequency"/);assert.match(home,/id="startingPoint"/);
    assert.doesNotMatch(home,/pré-lançamento|identificação legal por completar/i);
    const privacy=await readFile(path.join(directory,'privacidade/index.html'),'utf8');
    assert.match(privacy,/30 dias/);assert.match(privacy,/Estados Unidos/);assert.match(privacy,/interesse legítimo/);
    for(const page of ['index.html','privacidade/index.html','aviso-legal/index.html','cookies/index.html']){
      assert.doesNotMatch(await readFile(path.join(directory,page),'utf8'),/\[[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ][^\]]+\]/);
    }
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('exportação só liga um endpoint HTTPS explícito e inclui-o na política de ligações',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'time-saver-pages-api-'));
  try {
    const output=path.join(directory,'out');
    await buildGitHubPages({outputDirectory:output,origin:'https://timesaverautomate.com',basePath:'/',apiOrigin:'https://api.timesaverautomate.com'});
    const html=await readFile(path.join(output,'index.html'),'utf8');
    assert.match(html,/time-saver-form-mode" content="backend"/);
    assert.match(html,/time-saver-api-origin" content="https:\/\/api\.timesaverautomate\.com"/);
    assert.match(html,/connect-src 'self' https:\/\/api\.timesaverautomate\.com/);
    for(const apiOrigin of ['http://api.test','https://api.test/path','https://user:password@api.test']) {
      await assert.rejects(buildGitHubPages({outputDirectory:output,apiOrigin}));
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});
