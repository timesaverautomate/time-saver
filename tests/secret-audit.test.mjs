import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const script=fileURLToPath(new URL('../scripts/audit-repository-secrets.py',import.meta.url));
function repository() {
  const directory=mkdtempSync(path.join(tmpdir(),'timesaver-audit-'));
  const git=(...args)=>execFileSync('git',['-C',directory,...args],{stdio:'pipe'});
  git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  return {directory,git,commit:()=>{git('add','.');git('-c','commit.gpgsign=false','commit','-m','Fixture');}};
}
test('auditoria aceita configuração sem valores e fixtures de teste conhecidas',()=>{
  const repo=repository();
  try {
    writeFileSync(path.join(repo.directory,'.env.example'),'RESEND_API_KEY=\nSECURITY_HMAC_KEY=\n');
    writeFileSync(path.join(repo.directory,'fixture.txt'),'re_only_a_unit_test_value\nre_test_only_not_a_real_key\nre_test_only_deployment\n');
    repo.commit();
    const result=spawnSync('python',[script,'--repository',repo.directory],{encoding:'utf8'});
    assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).passed,true);
  } finally {rmSync(repo.directory,{recursive:true,force:true});}
});
test('auditoria encontra credencial apagada do ficheiro atual sem imprimir o valor',()=>{
  const repo=repository();
  try {
    const fixture='re_'+'X'.repeat(32);
    writeFileSync(path.join(repo.directory,'example.txt'),fixture);repo.commit();
    writeFileSync(path.join(repo.directory,'example.txt'),'Valor removido\n');repo.commit();
    const result=spawnSync('python',[script,'--repository',repo.directory],{encoding:'utf8'});
    const data=JSON.parse(result.stdout);
    assert.equal(result.status,1);assert.equal(data.passed,false);
    assert.equal(data.commits_checked,2);assert.ok(data.findings.length>0);
    assert.equal(result.stdout.includes(fixture),false);
    assert.equal(data.secret_values_printed,false);
  } finally {rmSync(repo.directory,{recursive:true,force:true});}
});
test('auditoria deteta bloco PEM completo mas ignora texto de instruções',()=>{
  const repo=repository();
  try {
    writeFileSync(path.join(repo.directory,'instructions.js'),
      "const pattern = /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/;\n");
    repo.commit();
    let result=spawnSync('python',[script,'--repository',repo.directory],{encoding:'utf8'});
    assert.equal(result.status,0);
    writeFileSync(path.join(repo.directory,'secret.txt'),
      '-----BEGIN PRIVATE KEY-----\n'+'A'.repeat(64)+'\n-----END PRIVATE KEY-----\n');
    repo.commit();
    result=spawnSync('python',[script,'--repository',repo.directory],{encoding:'utf8'});
    assert.equal(result.status,1);
    assert.ok(JSON.parse(result.stdout).findings.some(x=>x.rule==='private-key'));
  } finally {rmSync(repo.directory,{recursive:true,force:true});}
});
test('auditoria deteta token Resend com hífen no histórico sem divulgar o valor',()=>{
  const repo=repository();
  try {
    const fixture='re_'+'A'.repeat(8)+'-'+'B'.repeat(20);
    writeFileSync(path.join(repo.directory,'token-fixture.txt'),fixture);repo.commit();
    writeFileSync(path.join(repo.directory,'token-fixture.txt'),'Credencial removida\n');repo.commit();
    const result=spawnSync('python',[script,'--repository',repo.directory],{encoding:'utf8'});
    const data=JSON.parse(result.stdout);
    assert.equal(result.status,1);assert.equal(data.passed,false);
    assert.equal(data.commits_checked,2);
    assert.ok(data.findings.some(finding=>finding.rule==='resend-token'&&finding.path==='token-fixture.txt'));
    assert.equal((result.stdout+result.stderr).includes(fixture),false);
    assert.equal(data.secret_values_printed,false);
  } finally {rmSync(repo.directory,{recursive:true,force:true});}
});
test('auditoria deteta PEM de conta Google em JSON e em JSON escapado sem divulgar o conteúdo',()=>{
  for(const [escapedAgain,newline] of [[false,'\n'],[true,'\n'],[false,'\r\n'],[true,'\r\n']]){
    const repo=repository();
    try {
      const key='-----BEGIN '+'PRIVATE KEY-----'+newline+'A'.repeat(64)+newline+'-----END '+'PRIVATE KEY-----'+newline;
      const account={type:'service_account',private_key:key,client_email:'synthetic@example.invalid'};
      const serialized=escapedAgain?JSON.stringify(JSON.stringify(account)):JSON.stringify(account);
      writeFileSync(path.join(repo.directory,'service-account.json'),serialized);repo.commit();
      writeFileSync(path.join(repo.directory,'service-account.json'),'{}');repo.commit();
      const result=spawnSync('python',[script,'--repository',repo.directory],{encoding:'utf8'});
      const data=JSON.parse(result.stdout);
      assert.equal(result.status,1);assert.equal(data.passed,false);
      assert.equal(data.commits_checked,2);
      assert.ok(data.findings.some(finding=>finding.rule==='private-key'&&finding.path==='service-account.json'));
      assert.equal((result.stdout+result.stderr).includes(serialized),false);
      assert.equal((result.stdout+result.stderr).includes('A'.repeat(64)),false);
      assert.equal(data.secret_values_printed,false);
    } finally {rmSync(repo.directory,{recursive:true,force:true});}
  }
});
test('auditoria deteta segredo Svix/Resend apagado do histórico sem imprimir o valor',()=>{
  const repo=repository();
  try {
    const fixture='whsec_'+'A'.repeat(36)+'+/==';
    writeFileSync(path.join(repo.directory,'.env'),'RESEND_WEBHOOK_SECRET="'+fixture+'"\n');repo.commit();
    writeFileSync(path.join(repo.directory,'.env'),'RESEND_WEBHOOK_SECRET=\n');repo.commit();
    const result=spawnSync('python',[script,'--repository',repo.directory],{encoding:'utf8'});
    const data=JSON.parse(result.stdout);
    assert.equal(result.status,1);assert.equal(data.passed,false);
    assert.ok(data.findings.some(finding=>finding.rule==='svix-signing-secret'&&finding.path==='.env'));
    assert.equal((result.stdout+result.stderr).includes(fixture),false);
    assert.equal(data.secret_values_printed,false);
  } finally {rmSync(repo.directory,{recursive:true,force:true});}
});
test('padrões e instruções de segredos escapados não geram falsos positivos',()=>{
  const repo=repository();
  try {
    writeFileSync(path.join(repo.directory,'instructions.txt'),[
      'Use um segredo com prefixo whsec_ no gestor da plataforma.',
      String.raw`r"\bwhsec_[A-Za-z0-9+/=_-]{24,}"`,
      String.raw`-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----`,
    ].join('\n'));repo.commit();
    const result=spawnSync('python',[script,'--repository',repo.directory],{encoding:'utf8'});
    assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).passed,true);
  } finally {rmSync(repo.directory,{recursive:true,force:true});}
});

test('exceção da fixture Cloudflare é exata e não isenta tokens desconhecidos',()=>{
  const repo=repository();
  try{
    writeFileSync(path.join(repo.directory,'fixture.js'),"const env={CLOUDFLARE_API_TOKEN:'unit-test-cloudflare-key-'.repeat(2)};\n");repo.commit();
    let result=spawnSync('python',[script,'--repository',repo.directory],{encoding:'utf8'});
    assert.equal(result.status,0);
    const value='X'.repeat(32);
    writeFileSync(path.join(repo.directory,'config.env'),'CLOUDFLARE_API_TOKEN="'+value+'"\n');repo.commit();
    result=spawnSync('python',[script,'--repository',repo.directory],{encoding:'utf8'});
    assert.equal(result.status,1);assert.ok(JSON.parse(result.stdout).findings.some(x=>x.rule==='secret-assignment'));
    assert.equal(result.stdout.includes(value),false);
  }finally{rmSync(repo.directory,{recursive:true,force:true});}
});
