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
