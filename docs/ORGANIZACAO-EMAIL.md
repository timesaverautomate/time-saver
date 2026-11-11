# Organização do email da Time Saver

A caixa central é `timesaverautomate@gmail.com`; a folha CRM regista o estado comercial, orçamento e próxima ação. As etiquetas foram criadas e as mensagens existentes organizadas. Os filtros permanentes estão preparados num ficheiro XML entregue na conversa e ficam ativos após importação no Gmail. Não foram configuradas respostas automáticas.

## Etiquetas

| Etiqueta | Utilização |
| --- | --- |
| `01 Pedidos do sítio` | Pedidos recebidos pelo formulário. Entram na caixa de entrada para análise e resposta. |
| `02 Aguardar resposta` | Conversas em que a Time Saver já respondeu e aguarda esclarecimentos ou decisão. |
| `03 Clientes e projetos` | Correspondência de projetos aprovados e em curso. |
| `04 Agenda` | Confirmações, alterações e cancelamentos do Calendly. |
| `05 Gestão/Faturas` | Faturas e confirmações de pagamentos. |
| `05 Gestão/Domínio` | Registo, renovação e avisos do domínio. |
| `06 Técnico/Alertas` | Falhas de envio, publicações com erro, alertas de acesso e problemas que exigem ação. |
| `06 Técnico/Rotina` | Notificações de sucesso e informação técnica de rotina já identificada. |
| `06 Técnico/Testes internos` | Emails de testes internos confirmados, marcados manualmente e arquivados após validação. |
| `06 Técnico/Histórico` | Avisos antigos de problemas cuja correção já foi confirmada. |
| `07 Prospecção` | Conversas comerciais iniciadas pela Time Saver, separadas dos pedidos recebidos espontaneamente. |

## Percurso diário

1. Um pedido novo fica na caixa de entrada e recebe a etiqueta `01 Pedidos do sítio`.
2. Após analisar, responder ou pedir esclarecimentos, atualizar a próxima ação na folha CRM.
3. Se a ação seguinte for do cliente, aplicar `02 Aguardar resposta` e usar **Adiar** no Gmail até à data escolhida para rever o assunto.
4. Quando houver aprovação, aplicar `03 Clientes e projetos` e manter o estado comercial na folha.
5. Arquivar conversas tratadas. Usar a estrela para assuntos urgentes concretos. A caixa de entrada representa trabalho por tratar; “não lido” representa apenas leitura.

Não seria necessário criar uma etiqueta para cada macro, dashboard ou ferramenta: essa informação já é recolhida no formulário e fica na folha CRM.

## Filtros e vista

Para identificar pedidos do formulário, testar primeiro no campo de pesquisa do Gmail:

```text
from:pedidos@timesaverautomate.com subject:"Time Saver — Novo pedido de orçamento"
```

Depois criar um filtro que aplique `01 Pedidos do sítio` e os mantenha na caixa de entrada. Manter a proteção de spam do Gmail ativa. Um remetente visível não substitui a autenticação da mensagem.

Os novos pedidos mostram o nome no início e uma referência única no fim do assunto. Exemplo: `Maria Silva — Time Saver — Novo pedido de orçamento — TS-…`. Mesmo dois pedidos do mesmo nome têm referências e assuntos diferentes. O texto fixo antigo permanece no assunto, pelo que os filtros anteriores continuam compatíveis.

Os emails já recebidos conservam o assunto original. Para os apresentar individualmente, desativar a **vista de conversa** em **Definições → Ver todas as definições → Geral → Vista de conversa → Vista de conversa desativada → Guardar alterações**. A ligação disponível não permite alterar esta preferência ou renomear mensagens recebidas. A referência `TS-…` continua a relacionar cada email com o CRM.

As tentativas iniciadas antes da atualização conservam o assunto anterior durante a validade do ticket, para preservar a idempotência do Resend. Novas sessões recebem o formato identificado com nome e referência. Não se reenviam os pedidos antigos para lhes mudar o título.

As notificações técnicas de sucesso podem ser etiquetadas e arquivadas automaticamente após testar os critérios. Falhas, alertas de segurança, problemas de pagamento, renovações e alterações de reuniões devem continuar visíveis. Evitaria filtros amplos por fornecedor que misturem informação de rotina com alertas.

## Responder aos clientes

O formulário já define o email validado do visitante em **Reply-To**. O botão **Responder** deve dirigir a resposta ao visitante; confirmar o destinatário e o pedido selecionado antes de enviar. As respostas humanas saem pela caixa Gmail atual. O Resend envia a notificação do sítio e não cria, por si só, uma caixa de entrada em `pedidos@timesaverautomate.com`.

Ativaria os **Modelos** do Gmail para quatro respostas manuais: primeiro contacto, pedido de esclarecimentos, envio de proposta e seguimento de uma proposta. Prepararia versões PT e EN. A referência do pedido, o âmbito e os valores devem ser revistos em cada resposta. Manteria esta primeira versão sem respostas automáticas aos visitantes.

Assinatura curta sugerida:

```text
Time Saver
Automatização em Excel, VBA e Power Automate
https://timesaverautomate.com
Marcar conversa: https://calendly.com/timesaverautomate/30min
```

## Segurança e conservação

Usar chave de acesso ou verificação em dois passos, confirmar a recuperação da conta e limitar acessos operacionais. Manter alertas de segurança visíveis e evitar copiar dados confidenciais para assuntos ou convites de agenda.

Arquivar não elimina dados. A revisão e eliminação de pedidos deve seguir a política de conservação, incluindo cópias no Gmail, CRM e fornecedor de email. Esta organização pode funcionar no Gmail atual, sem contratar uma ferramenta adicional.
