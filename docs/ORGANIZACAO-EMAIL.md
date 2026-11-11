# Organização proposta para o email da Time Saver

Usaria `timesaverautomate@gmail.com` como caixa central e a folha CRM como registo do estado comercial, orçamento e próxima ação. A organização abaixo é uma proposta; não foram criadas etiquetas, filtros ou respostas automáticas na conta.

## Etiquetas

| Etiqueta | Utilização |
| --- | --- |
| `01 Pedidos do sítio` | Pedidos recebidos pelo formulário. Entram na caixa de entrada para análise e resposta. |
| `02 Aguardar resposta` | Conversas em que a Time Saver já respondeu e aguarda esclarecimentos ou decisão. |
| `03 Clientes e projetos` | Correspondência de projetos aprovados e em curso. |
| `04 Agenda` | Confirmações, alterações e cancelamentos do Calendly. |
| `05 Gestão` | Faturas de fornecedores, domínio, alojamento e assuntos administrativos. |
| `06 Técnico/Alertas` | Falhas de envio, publicações com erro, alertas de acesso e problemas que exigem ação. |
| `06 Técnico/Rotina` | Notificações de sucesso e informação técnica de rotina já identificada. |
| `06 Técnico/Testes` | Emails de testes internos confirmados, marcados manualmente e arquivados após validação. |
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

Desativaria a **vista de conversa** nesta caixa: o formulário usa um assunto fixo e o mesmo remetente, pelo que é útil apresentar cada pedido separadamente. A referência `TS-…` permite relacionar o email com o CRM. Esta opção fica em **Definições → Ver todas as definições → Geral → Vista de conversa**.

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
