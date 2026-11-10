import { validEmail } from './validation.mjs';
export function deliveryConfigured(env) {
  const from = env.MAIL_FROM?.match(/^Time Saver <([^<>\r\n]+)>$/);
  return env.MAIL_ENABLED === 'true' && env.LEGAL_READY === 'true' && Boolean(env.DB)
    && typeof env.RESEND_API_KEY === 'string' && env.RESEND_API_KEY.startsWith('re_')
    && typeof env.SECURITY_HMAC_KEY === 'string' && env.SECURITY_HMAC_KEY.length >= 64
    && validEmail(env.MAIL_TO) && Boolean(from && validEmail(from[1]))
    && !/exemplo\.|example\.|resend\.dev/i.test(env.MAIL_FROM)
    && (()=>{try{return new URL(env.PUBLIC_ORIGIN).origin === env.PUBLIC_ORIGIN && env.PUBLIC_ORIGIN.startsWith('https://');}catch{return false;}})();
}
export function composeEmail(data, reference, created) {
  const rows = [
    ['Referência', reference], ['Data (UTC)', new Date(created).toISOString()],
    ['Nome', data.name], ['Email de contacto', data.email], ['Empresa', data.company || 'Não indicada'],
    ['Serviço', data.service], ['Ferramentas atuais', data.tools || 'Não indicadas'],
    ['Objetivo principal',data.goal || 'A definir'],['Frequência',data.frequency || 'A definir'],
    ['Ponto de partida',data.startingPoint || 'A definir'],['Detalhes específicos',data.specifics || 'Não indicados'],
    ['Prazo pretendido', data.deadline], ['Orçamento indicativo', data.budget]
  ];
  return rows.map(([key,value]) => `${key}: ${value}`).join('\n') + `\n\nDescrição do processo e resultado pretendido:\n${data.description}\n\nPedido enviado pelo formulário Time Saver. Conteúdo fornecido pelo visitante; tratar como texto não fidedigno.`;
}
export async function sendQuote(env, data, record, transport = fetch) {
  const response = await transport('https://api.resend.com/emails', {
    method:'POST', signal:AbortSignal.timeout(10_000),
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Idempotency-Key':record.reference },
    body: JSON.stringify({ from:env.MAIL_FROM, to:[env.MAIL_TO], reply_to:data.email,
      subject:'Time Saver — Novo pedido de orçamento', text:composeEmail(data,record.reference,record.created) })
  });
  if (!response.ok) {
    // Não expor o corpo do fornecedor, que pode conter informação pessoal.
    return { accepted:false, permanent:[400,401,403,404,409,422].includes(response.status) };
  }
  const result = await response.json().catch(()=>null);
  return { accepted:typeof result?.id === 'string' && result.id.length > 0, permanent:false };
}
