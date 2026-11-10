# Formulário atual: email direto e integração com Sheets em preparação

## Fluxo e conservação

1. O visitante abre o domínio HTTPS e recebe um ticket assinado, mantido na memória da página.
2. Escolhe o tipo de ajuda e descreve o processo. O servidor valida novamente todos os valores.
3. O Worker envia texto simples pelo Resend, com assunto e destinatário fixos. Não há gravação intermédia do pedido.
4. A página mostra sucesso apenas quando o Resend devolve um identificador de aceitação. A entrega efetiva é verificada na caixa Gmail, não inferida dessa resposta.

Enquanto a sincronização não estiver ativada, a aplicação não grava pedidos em D1, KV, Durable Objects, filas, CRM ou folhas de cálculo; não regista o conteúdo nos logs. A observabilidade do Worker está desativada. Os campos permanecem na página aberta em caso de falha e são limpos após a aceitação. As funções de preenchimento automático pertencem ao navegador do visitante.

O Resend declara conservar conteúdo e registos 30 dias, com armazenamento nos EUA mesmo quando o envio sai da região europeia. As cópias de segurança do fornecedor podem prolongar a eliminação conforme a sua política. Não há promessa de apagamento imediato pelo site. O titular aceitou expressamente manter o serviço nestes termos. Referência: https://resend.com/security/gdpr/.

A mensagem recebida permanece no Gmail. Rever mensalmente os pedidos encerrados e apagar os que já não sejam necessários para resposta, proposta, contrato, defesa de direitos ou obrigações aplicáveis. Esvaziar o lixo segundo as regras da caixa. Não existe um prazo legal universal de retenção de orçamentos. A adoção desta rotina e os contratos/garantias dos fornecedores são responsabilidades operacionais ainda por validar pelo titular.

## Integração opcional com o CRM TimeSaver

Foi preparado o separador privado `Pedidos do Site` no Google Sheets e o módulo `src/quote-sheets.mjs`. Quando a configuração `quoteSheetSyncEnabled` estiver ativa e a conta de serviço tiver acesso de escrita, o Worker guardará o pedido antes de fazer o envio transacional pelo Resend, sem expor a chave Google no browser ou nos logs. A referência é a chave de deduplicação; um novo pedido fica inicialmente com o estado `Pendente envio` e, após aceitação pelo Resend, muda para `Novo`. Se a gravação falhar, o formulário não apresenta sucesso e conserva os campos para repetir. A sincronização acrescenta uma cópia dos dados na Google e exige regras de acesso, retenção e apagamento.

O módulo ainda requer validação operacional real antes da ativação; as políticas e contratos de tratamento também devem ser revistos.

## Remetente e DNS

Remetente fixo: `Time Saver <pedidos@timesaverautomate.com>`. Destinatário fixo: `timesaverautomate@gmail.com`. O visitante apenas define o Reply-To através de um email validado. Corpo de texto simples, sem HTML e sem anexos. Referência determinística e data do início do formulário incluídas; o cabeçalho Date do email indica o envio.

O teste do remetente foi recebido na caixa de entrada em 10/11/2026. Os cabeçalhos recebidos pelo Gmail confirmam **SPF, DKIM e DMARC pass**. A política DMARC observada é `p=none`, de monitorização. Para futuras alterações de domínio:

- No Resend, adicionar/verificar o domínio e copiar os registos DNS exatos fornecidos para Cloudflare → DNS. Não inventar valores DKIM.
- Manter o TXT DKIM do seletor `resend._domainkey` sem proxy. Os registos do subdomínio de retorno devem corresponder ao fornecedor; não substituir os MX do domínio principal.
- Manter um único SPF por nome DNS; integrar fornecedores legítimos em vez de duplicar registos SPF.
- Rever todos os emissores antes de alterar DMARC de monitorização para quarentena/rejeição, para não bloquear correio legítimo. Validar alinhamento e entrega depois da mudança.
- Não remover os registos do domínio enquanto o remetente estiver ativo. A chave API deve ter apenas permissão de envio e, quando possível, restrição ao domínio.

## Abuso e duplicados

Tickets HMAC, tempo mínimo de preenchimento e validade de 23 horas; origem HTTPS exata; honeypot oculto também às tecnologias de apoio; JSON limitado a 16 KiB e 8 segundos totais de leitura; validação de tipos, formatos e listas de opções. CORS não é considerado proteção contra bots.

Contadores nativos Cloudflare: 5 tentativas/minuto por origem derivada em HMAC diário (endereço IPv4 ou rede IPv6 /64), 30 envios válidos/minuto por localização de execução e 30 consultas de disponibilidade/minuto pela mesma origem de rede. Pedidos já limitados ou inválidos não consomem o contador partilhado de envios. São contadores técnicos transitórios, sem nomes, emails ou descrições. A limitação nativa é aproximada e distribuída por localização, não uma quota global estrita. As quotas da conta Resend limitam adicionalmente o envio; não há atualização automática para planos pagos. Se a pressão de abuso aumentar, reavaliar limites e um desafio acessível, bem como o tratamento de dados associado.

A chave de tentativa permanece apenas em memória e é reutilizada quando os mesmos dados são reenviados após falha. O servidor deriva a chave de idempotência do Resend e uma referência estável. O Resend conserva a resposta para a mesma chave durante 24 horas; o corpo e a data permanecem estáveis. Duplo clique é bloqueado também no navegador. Pedidos iniciados numa nova página ou alterados constituem novas tentativas; não existe deduplicação permanente por nome/email/conteúdo.

## Falhas e manutenção

Se o fornecedor falhar, a página informa que não confirmou o envio e conserva os campos na página aberta. Não há fila persistente nem garantia de reenvio após fechar a página. Tentar novamente com os mesmos dados conserva a chave enquanto a página estiver aberta. Nunca registar o corpo para diagnosticar problemas; usar apenas estado técnico/referência.

Restringir o acesso às contas GitHub, Cloudflare, Resend e Gmail, ativar MFA e rever acessos. Rever atualizações e Actions fixadas em SHAs; rodar credenciais em caso de exposição. Manter tokens apenas em Secrets e no servidor. Controlar quotas, falhas e a pasta de spam sem exportar pedidos para outros sistemas. As contas operacionais não criam contas no site público.

## Privacidade e obrigações pendentes

Fundamento proposto: RGPD 6.º/1/b para diligências pré-contratuais quando o titular é a futura parte; 6.º/1/f para contactos profissionais de representantes e prevenção de abuso. A avaliação do interesse legítimo deve registar o pedido espontâneo, a finalidade limitada, os poucos campos obrigatórios, a ausência de marketing e o canal de oposição. Não há consentimento genérico obrigatório.

Validar contratos de tratamento aplicáveis com Cloudflare, Resend e Google, respetivos subcontratantes, transferências e garantias efetivamente contratadas. A consulta das políticas públicas não prova que os contratos da conta foram revistos. Não declarar processamento exclusivamente europeu.

O titular optou por omitir a identificação legal. A publicação técnica não resolve as obrigações de identificação do responsável/prestador; rever identidade, reclamações e RAL conforme a atividade, antes de considerar o enquadramento jurídico completo. As minutas com marcadores no código ajudam a futura conclusão; não inventam dados nem afirmam conformidade. Sem analítica ou publicidade; voltar a verificar cookies após qualquer integração ou alteração de segurança da zona Cloudflare.
