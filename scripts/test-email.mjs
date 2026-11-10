import { pathToFileURL } from 'node:url';

// Diagnóstico operacional executado no GitHub Actions, nunca no navegador.
// O remetente resend.dev serve exclusivamente para testes para a própria conta.
export async function testEmailConnection({ apiKey, transport = fetch, now = new Date() } = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key.startsWith('re_') || key.length < 10 || /[\r\n]/.test(key)) {
    return { accepted:false, message:'Adicione um segredo de repositório chamado RESEND_API_KEY nas definições do GitHub. Não cole a chave em ficheiros ou logs.' };
  }
  const reference = 'time-saver-setup-' + now.toISOString().slice(0,10);
  const payload = {
    from:'Time Saver <onboarding@resend.dev>',
    to:['timesaverautomate@gmail.com'],
    subject:'Time Saver — Teste técnico de envio',
    text:'Teste técnico da ligação Time Saver ao Resend.\n\nReferência: ' + reference
      + '\n\nEste email testa exclusivamente o serviço de envio. O formulário comercial continua desativado.'
  };
  try {
    const response = await transport('https://api.resend.com/emails',{
      method:'POST', signal:AbortSignal.timeout(10_000),
      headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':reference},
      body:JSON.stringify(payload)
    });
    if (!response.ok) return {
      accepted:false,httpStatus:response.status,
      message:'O Resend recusou o teste. Confirme a chave e que a conta Resend foi criada com timesaverautomate@gmail.com. O remetente de teste só permite enviar para o email da própria conta.'
    };
    const data = await response.json().catch(()=>null);
    if (typeof data?.id !== 'string' || !data.id) return { accepted:false,message:'O serviço não devolveu uma confirmação válida. A aceitação não foi confirmada.' };
    return {
      accepted:true,providerId:data.id,reference,inboxDeliveryConfirmed:false,
      message:'O Resend aceitou o teste para envio. Confirme a receção em timesaverautomate@gmail.com, incluindo a pasta de spam. Esta aceitação não confirma a entrega na caixa.'
    };
  } catch {
    return { accepted:false,message:'Não foi possível confirmar o envio. Uma nova execução no mesmo dia UTC reutiliza a referência para evitar duplicados.' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await testEmailConnection({apiKey:process.env.RESEND_API_KEY});
  console.log(JSON.stringify(result,null,2));
  if (!result.accepted) process.exitCode = 1;
}
