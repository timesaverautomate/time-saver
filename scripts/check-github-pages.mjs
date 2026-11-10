import { appendFile } from 'node:fs/promises';

const repository = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const token = process.env.GITHUB_TOKEN;
const runId = process.env.GITHUB_RUN_ID;
const repositoryId = process.env.GITHUB_REPOSITORY_ID;
if (repositoryId !== '1452563434' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !/^[a-f0-9]{40}$/.test(sha || '') || !/^\d+$/.test(runId || '') || !token) {
  console.error('Execute este diagnóstico no workflow autorizado da Time Saver.');
  process.exit(1);
}
const target = 'https://github.com/'+repository+'/actions/runs/'+runId;
async function github(endpoint,options = {}) {
  return fetch('https://api.github.com/repos/'+repository+endpoint,{
    ...options,redirect:'error',signal:AbortSignal.timeout(10_000),
    headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'}
  });
}
async function status(state,description) {
  const response = await github('/statuses/'+sha,{
    method:'POST',body:JSON.stringify({state,description,target_url:target,context:'time-saver/github-pages'})
  });
  if (!response.ok) throw new Error('Não foi possível registar o diagnóstico.');
}
try {
  await status('pending','A verificar disponibilidade do alojamento GitHub Pages.');
  const response = await github('/pages');
  const configured = response.ok;
  const data = configured ? await response.json() : {};
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,'configured='+String(configured)+'\n');
  console.log(JSON.stringify({
    configured,httpStatus:response.status,publicationVerified:false,
    pagesURL:data.html_url || null,
    settingsURL:'https://github.com/'+repository+'/settings/pages',
    message:configured
      ? 'Configuração Pages encontrada. A publicação depende da validação legal e do job de publicação.'
      : 'GitHub Pages não está configurado ou não está acessível. Num repositório privado, confirmar a elegibilidade do plano e ativar Pages nas definições. Não foi alterada a visibilidade nem contratado qualquer plano.'
  },null,2));
  await status(configured ? 'success' : 'failure',configured
    ? 'Configuração Pages encontrada; publicação ainda por validar.'
    : 'GitHub Pages por ativar; confirmar plano e definições do repositório.');
} catch {
  console.error('Não foi possível confirmar a configuração GitHub Pages. Nenhuma visibilidade ou plano foi alterado.');
  await status('failure','Não foi possível verificar a configuração GitHub Pages.').catch(()=>{});
  process.exitCode=1;
}
