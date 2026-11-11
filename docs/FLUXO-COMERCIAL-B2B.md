# TimeSaver — circuito B2B operacional (11/11/2026)

## Fluxo completo

1. **Descoberta diária** — `.github/workflows/prospect-crm.yml`, 08:15 UTC. OSM em oito pequenas zonas/dia, com prioridade aos subúrbios, rotação de zonas e até 15 empresas novas no CRM por dia. Nenhum envio durante a descoberta.
2. **CRM** — `Pedidos` guarda empresa, website, email genérico, telefone, fonte, estado e deduplicação. Novas linhas entram obrigatoriamente com `Y=Sim` e `X=Por avaliar`.
3. **Revisão** — `Revisão Comercial` apresenta o candidato e uma proposta orientada ao setor; a empresa não passa automaticamente à fase seguinte.
4. **Aprovação** — a TimeSaver verifica empresa, endereço, oposição DGC quando aplicável e regista os comprovativos no CRM.
5. **Envio via Resend (apenas opt-in)** — `.github/workflows/outreach-legal.yml` pesquisa apenas linhas com consentimento documentado e aprovação, de segunda a sexta às 09:30 UTC. Máximo cinco/dia, nunca duas vezes para o mesmo domínio. **A prospeção fria está bloqueada neste fornecedor.**
6. **Acompanhamento** — o mesmo workflow consulta os últimos eventos do Resend diariamente às 16:30 UTC e atualiza estados no Sheets.
7. **Resposta e oportunidades** — o email usa `reply_to: timesaverautomate@gmail.com`. Respostas, pedidos de oposição, reuniões e propostas ainda exigem intervenção humana; não estão falsamente automatizados.

## Como autorizar uma linha sem confundir ranking com elegibilidade

Na linha correspondente à empresa no separador **Revisão Comercial**:
- I `Estado de revisão`: escrever **Verificado**, só após verificar o contacto e a entidade.
- J `Base legal / autorização`: selecionar **Pessoa coletiva - fundamento validado** (apenas quando realmente aplicável) ou **Consentimento documentado**. **Apenas o segundo valor permite email pelo Resend; o primeiro é para investigação/canal futuro compatível.**
- M `Natureza jurídica`: indicar **Pessoa coletiva** ou **Pessoa singular**, conforme evidência.
- N `Consulta DGC (AAAA-MM-DD)`: data da consulta efetiva à lista oficial, obrigatória quando a base invocada é pessoa coletiva, com validade operacional máxima de 31 dias.
- O `Email confirmado (AAAA-MM-DD)`: data de verificação do email na fonte primária, até 90 dias.
- P `Fonte de validação`: página ou referência factual que suporta a avaliação; para consentimento, guardar prova adequada noutro local seguro.
- Q `Autorização de envio`: **Aprovado** apenas depois das verificações.
- R `Gancho comercial verificado`: informação real e verificável para personalizar o email, ou deixar vazio.
- S `Data aprovação (AAAA-MM-DD)`: aprovação explícita emitida até 30 dias antes do envio.

No separador **Pedidos**, para a mesma empresa:
- X `Consentimento/base legal` tem de **coincidir exatamente com a célula J** da revisão.
- Y `Não contactar` tem de ser alterado manualmente de `Sim` para **Não**, mas só quando não existe oposição.
- Se a empresa solicitou não receber emails, manter/colocar Y=`Sim` e nunca limpar um bloqueio de entrega ou reclamação.

O motor verifica ainda que a revisão tem a mesma linha de CRM, nome, email e domínio; que o endereço é genérico, empresarial e coincide com o website; que não foi enviado email anteriormente e que não há bloqueios noutra linha.

**IMPORTANTE — RESTRIÇÃO DO RESEND:** a política de utilização de 13/10/2026 proíbe cold outreach, mesmo a pessoas coletivas. O código impede envios Resend com fundamento `Pessoa coletiva - fundamento validado`, ainda que legalmente válido. Os leads sem opt-in continuam no CRM para pesquisa e contacto por canal permitido. Fonte: https://resend.com/legal/acceptable-use

**Importante:** o sistema não consulta sozinho a lista da DGC, não identifica a natureza jurídica a partir do OSM e não confirma automaticamente que o negócio tem 1–50 trabalhadores. A consulta oficial DGC é obrigatória para o fluxo de comunicações não solicitadas às pessoas coletivas, e compete à TimeSaver documentá-la. A documentação escrita **não equivale a validação jurídica do caso**.

Fontes oficiais:
- https://www.consumidor.gov.pt/!0/informacao-publicidade/publicidade-nao-solicitada-pessoas-coletivas
- https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2004-106523049-183878511
- https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2004-106523049-183907401

## Segurança operacional

- **Agendamento de envio:** GitHub Actions a 09:30 UTC de segunda a sexta, no grupo de concorrência `timesaver-prospeccao-crm` usado também pela pesquisa.
- **Modo manual:** GitHub → Actions → `TimeSaver - prospeção aprovada e reconciliação Resend` → Run workflow. Modos `preview`, `send` ou `reconcile`. `send` requer escrever `ENVIAR` no campo de confirmação.
- **Testes em push:** a alteração dos scripts gera testes e uma pré-visualização real dos contactos, **sem envio**.
- **Limite:** cinco envios/dia, **somente a destinatários com opt-in**; zero follow-ups automáticos.
- **Idempotência:** antes de chamar o Resend, o CRM recebe em V `Reservado: timesaver-b2b-v1-...`. O Resend recebe um `Idempotency-Key` estável por domínio+email.
- **Falhas/timeout:** a reserva permanece bloqueada e **não deve ser removida nem repetida automaticamente**. Confirmar no painel Resend se houve mensagem e reconciliar manualmente antes de tentar recuperar. A idempotência do Resend só cobre 24 horas.
- **Confirmação de envio:** uma resposta de sucesso do Resend acrescenta datas R/S, seguimento T, contador U, estado V, ID W, estado comercial J e próxima ação L/M.
- **Entrega:** consulta diária `GET /emails/:id` e atualiza V; bounce, reclamação ou supressão põe Y=`Sim`.
- **Opt-out:** cada email permite oposição gratuita por resposta «Não contactar». Até existir leitura automática autorizada da caixa de entrada, os responsáveis devem marcar imediatamente Y=`Sim` ao receber essa resposta. Não é seguro ignorar pedidos de oposição.

## Limitações e evolução

- OSM pode estar incompleto. A pesquisa em subúrbios é uma hipótese comercial, não uma medição de saturação de emails.
- O uso continuado de instâncias Overpass públicas deve respeitar as respetivas políticas de uso comercial/limites. Para escalar, usar fornecedor com licença comercial ou instância própria.
- A exclusão de cadeias é parcial: domínio/email comum deduplica; grupos com marcas e domínios diferentes exigem revisão.
- A pontuação só ordena investigação; a capacidade financeira e a necessidade de automatização não são deduzidas do CAE.
- A gestão de respostas na caixa Gmail e das propostas/reuniões não está ligada automaticamente ao GitHub; preencher o CRM após receber resposta.
- Resend aceite não significa recebido na caixa de entrada. `Entregue` significa apenas aceitação pelo servidor.
