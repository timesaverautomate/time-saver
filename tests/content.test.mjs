import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const publicDir=new URL('../public/',import.meta.url);
const html=readFileSync(new URL('index.html',publicDir),'utf8');
test('conteúdo público: português, navegação interna e recursos locais existentes',()=>{
  assert.match(html,/<html lang="pt-PT">/);
  assert.equal((html.match(/<h1\b/g)||[]).length,1);
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]));
  for(const match of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.has(match[1]),'Âncora inválida: '+match[1]);
  for(const match of html.matchAll(/(?:src|href)="\/([^"#]+)"/g)) {
    if(['privacidade','cookies','aviso-legal'].includes(match[1])) continue;
    assert.ok(readdirSync(publicDir).includes(match[1]),'Recurso em falta: '+match[1]);
  }
  assert.match(html,/EXEMPLO ILUSTRATIVO/);
  assert.equal(/<input[^>]*type="(?:password|file)"/.test(html),false);
});
test('formulário acessível, sem armazenamento persistente nem submissão mailto',()=>{
  for(const input of [...html.matchAll(/<(?:input|textarea|select)\b[^>]*id="([^"]+)"[^>]*>/g)]) {
    assert.ok(html.includes('for="'+input[1]+'"'),'Etiqueta em falta: '+input[1]);
  }
  const js=readFileSync(new URL('app.js',publicDir),'utf8');
  assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie|mailto:/.test(js+html),false);
  assert.match(html,/aria-live="polite"/);assert.match(html,/aria-describedby="description-help/);
  assert.match(html,/<button[^>]*type="submit" disabled/);
  assert.match(js,/if \(busy \|\| sent\) return/);
  assert.match(js,/payload\.accepted === true/);
});
test('movimento reduzido, foco visível e layouts responsivos estão implementados',()=>{
  const css=readFileSync(new URL('styles.css',publicDir),'utf8');
  assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/:focus-visible/);
  assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/@media\(max-width:390px\)/);
});
test('todos os recursos e páginas são servidos pelo Worker; sem segredos no frontend',()=>{
  const bundle=readFileSync(new URL('../dist/server/index.js',import.meta.url),'utf8');
  for(const route of ['/','/privacidade','/cookies','/aviso-legal','/404','/app.js','/styles.css','/logo.svg'])assert.ok(bundle.includes(JSON.stringify(route)+':'));
  for(const file of readdirSync(publicDir)) {
    const text=readFileSync(new URL(file,publicDir),'utf8');
    assert.equal(/re_[A-Za-z0-9]{20,}|SECURITY_HMAC_KEY|RESEND_API_KEY|Bearer /.test(text),false);
  }
});
