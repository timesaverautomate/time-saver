let ready=false;
for(let attempt=0;attempt<24;attempt++){
  try{
    const response=await fetch('https://timesaverautomate.com/api/form-status',{
      redirect:'error',headers:{Origin:'https://timesaverautomate.com'},cache:'no-store',signal:AbortSignal.timeout(10_000)});
    const status=await response.json();
    if(response.ok&&status.available===true&&status.version==='direct-email-v1'){ready=true;break;}
  }catch{}
  if(attempt<23)await new Promise(resolve=>setTimeout(resolve,5000));
}
if(!ready){console.error('Publicação do formulário bloqueada: o serviço de envio direto ainda não está disponível. A versão anterior mantém-se publicada.');process.exitCode=1;}
else console.log('API de envio direto disponível. O envio real e a receção devem ser validados após publicação.');
