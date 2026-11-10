import { testEmailConnection } from './test-email.mjs';

const repository = process.env.GITHUB_REPOSITORY;
const commit = process.env.GITHUB_SHA;
const runId = process.env.GITHUB_RUN_ID;
const token = process.env.GITHUB_TOKEN;
if (repository !== 'usertechsitee/time-saver' || !/^[a-f0-9]{40}$/.test(commit || '') || !/^\d+$/.test(runId || '') || !token) {
  console.error('O diagnóstico deve ser executado pelo workflow autorizado no repositório Time Saver.');
  process.exit(1);
}
const runURL = 'https://github.com/' + repository + '/actions/runs/' + runId;
async function report(state,description) {
  const response = await fetch('https://api.github.com/repos/'+repository+'/statuses/'+commit,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),
    headers:{
      Authorization:'Bearer '+token,
      Accept:'application/vnd.github+json',
      'Content-Type':'application/json',
      'X-GitHub-Api-Version':'2022-11-28'
    },
    body:JSON.stringify({state,description,target_url:runURL,context:'time-saver/email-test'})
  });
  if (!response.ok) throw new Error('Não foi possível registar o resultado do diagnóstico no GitHub.');
}

try {
  await report('pending','A verificar a ligação Resend e o envio do email de teste.');
} catch {
  console.error('Não foi possível iniciar o registo do diagnóstico. Nenhum email foi solicitado por esta execução.');
  process.exit(1);
}
const result = await testEmailConnection({apiKey:process.env.RESEND_API_KEY});
console.log(JSON.stringify(result,null,2));
const validKey = typeof process.env.RESEND_API_KEY === 'string' && process.env.RESEND_API_KEY.trim().startsWith('re_');
const description = result.accepted
  ? 'Resend aceitou o email de teste; receção no Gmail por confirmar.'
  : !validKey
    ? 'Teste bloqueado: segredo RESEND_API_KEY ausente ou inválido.'
    : 'Envio não confirmado'+(result.httpStatus ? ' (HTTP '+result.httpStatus+')' : '')+'; consultar a execução.';
try {
  await report(result.accepted ? 'success' : 'failure',description);
} catch {
  console.error('Não foi possível atualizar o estado no GitHub. Consulte o resultado desta execução.');
  process.exitCode=1;
}
if (!result.accepted) process.exitCode=1;
