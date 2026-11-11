# TimeSaver — prospeção B2B de pequenas empresas

## Objetivo
Procurar preferencialmente **micro e pequenas empresas** portuguesas com processos administrativos que possamos ajudar a automatizar. O motor **não consegue verificar dimensão, faturação ou necessidade interna apenas a partir do OSM**; não as inventa.

## Geografia e rotação
O motor programa 8 zonas/dia: 3 subúrbios na região do Porto, 2 na região de Lisboa, 2 centros de cidades médias/regiões e apenas 1 centro urbano Porto/Lisboa. As zonas mudam diariamente por rotação determinística; cada consulta usa um raio local moderado. O resultado final é intercalado entre zonas, para não concentrar os registos na primeira cidade com contactos.

A localidade do CRM é retirada de `addr:city` quando a fonte a fornece. Quando não existe, apresenta-se `Área de <zona> (aproximada)` e uma nota a pedir confirmação. A ausência de website não elimina um candidato que tenha uma caixa comercial genérica identificada; exige investigação adicional.

## Setores e pontuação
Preferência inicial: contabilidade, imobiliário e distribuição. Outros serviços e lojas empresariais podem entrar no funil, com prioridade inferior.

A pontuação comercial de 0–100 serve **apenas para ordenar a investigação**:
- Adequação do setor: máximo 35.
- Geografia (preferência por subúrbios): máximo 25.
- Contacto e consistência de domínio: máximo 20.
- Dimensão: máximo 15, **só depois de prova/revisão** no CRM (`DIMENSAO_VERIFICADA=N`).
- Processo administrativo comprovado: máximo 5, **só após verificação humana** (`PROCESSO_VALIDADO=Sim`).
- Marca/cadeia indicada no OSM: penalização de 10, não exclusão automática.

Dimensão desconhecida não significa grande empresa; não recebe pontos inventados. A pontuação não é uma probabilidade de compra.

## Segurança, deduplicação e limites
Deduplicação por email, domínio, identificador de origem OSM e nome+localidade; o motor reconfirma antes de cada escrita. Até **15 novas linhas/dia**, com **máximo 5 por zona** na seleção inicial. Não se faz scraping ao Google Maps nem se usa uma base comercial paga sem licença. O OSM é um ponto de partida, não uma validação completa.

Toda a nova linha começa com `Não contactar=Sim` e `Consentimento/base legal=Por avaliar`. A aba `Revisão Comercial` mantém a decisão humana; nenhum script de pesquisa envia email. O modo `simular_resend` apenas testa a elegibilidade e monta rascunhos **sem contactar destinatários**.

## Execução
O workflow `.github/workflows/prospect-crm.yml` corre testes num push a `main` e pesquisa por agendamento (08:15 UTC diariamente). O modo manual `simular` não altera o CRM; `teste_escrita_2` adiciona até duas linhas bloqueadas; `simular_resend` não envia. A recolha diária, quando habilitada pelo workflow agendado, adiciona apenas potenciais clientes bloqueados para revisão. O trabalho humano continua necessário antes de qualquer prospeção externa.

## Métricas a validar
Registar por zona/setor: candidatos descobertos, novos após deduplicação, sites e emails confirmados, elegíveis legalmente, emails efetivamente enviados, respostas, reuniões e vendas. Não há taxa de resposta garantida.

## Circuito comercial completo — dois canais separados

1. **Descoberta OSM**: 8 zonas rotativas, preferência por subúrbios e empresas de menor dimensão. Pesquisa apenas pontos com email registado, sem presumir que a empresa é micro ou pequena.
2. **Qualificação**: excluir duplicados por email, domínio, identidade e OSM; atribuir score comercial apenas com factos observáveis; limite de 15 registos por dia e máximo de 5 por zona.
3. **Revisão Comercial**: novos contactos entram bloqueados em `Pedidos` e na lista de revisão. Verificar sociedade, email, domínio, atividade, indícios de dimensão, fonte e data; preencher campos M:S da aba de revisão; nunca gerar autorizações automaticamente.
4. **Canal de prospeção inicial**: pesquisa e preparação de rascunhos para avaliação. Contactos sem consentimento comprovado **não podem ser enviados pelo Resend**, mesmo que certas comunicações a sociedades sejam permitidas na legislação portuguesa. Não usar a infraestrutura Resend para cold outreach.
5. **Canal Resend opt-in**: apenas para destinatários com consentimento documentado e aprovação humana. `outreach-legal.yml` seleciona, limita a 5 envios por dia útil, reserva antes do envio, usa idempotência, grava identificador de mensagem e datas de contacto no CRM. Não faz follow-ups automáticos.
6. **Acompanhamento**: reconciliação automática do estado no Resend e bloqueio em caso de bounce/spam/supressão; qualquer resposta de oposição recebida por email deve ser registada manualmente no CRM no próprio dia, até haver integração de entrada autorizada e testada.

## Testes e operações

- Push a `main`: executa validação e testes sem credenciais de envio.
- Commit de teste com marcador `[smoke-crm]`: depois dos testes, faz uma consulta real do CRM e OSM **apenas em modo simulação**, sem escritas e sem envios. Consultas OSM podem falhar por indisponibilidade/rate limiting; o erro deve ser visível no GitHub Actions.
- Agenda diária `prospect-crm.yml`: recolha de novos candidatos bloqueados e sincronização da revisão; horário 08:15 UTC.
- Agenda de dias úteis `outreach-legal.yml`: verifica consentimentos documentados e, apenas nesse caso, envia até 5 mensagens autorizadas. Também reconcilia entregas. **Se não houver autorização documentada, 0 envios é o comportamento correto.**
- O Resend proíbe mensagens não solicitadas e dados recolhidos por scraping, conforme a política em https://resend.com/legal/acceptable-use (atualização 13/10/2026). Conformidade legal e aprovação contratual do fornecedor são verificações distintas.

## Teste de integração validado — 11/11/2026

Execução GitHub Actions: https://github.com/timesaverautomate/time-saver/actions/runs/43077489175

- 58 testes unitários passaram, incluindo deduplicação, elegibilidade, envio opt-in mockado, tracking e consulta Overpass por caixa empresarial.
- Teste vivo: leitura autenticada do Google Sheets CRM com 26 registos.
- Pesquisa de 8 zonas (5 suburbanas, 2 regionais, 1 centro): **8 consultas com sucesso; 0 falhas; 11 candidatos novos** após deduplicação em memória.
- Distribuição da amostra: Leça da Palmeira 1, Senhora da Hora 2, São Mamede de Infesta 1, Oeiras 0, Queluz 0, Ílhavo 0, Águeda 2 e Lisboa 5.
- Modo `simular`: **0 escritas no CRM, 0 emails enviados**.
- Uma execução anterior com consultas radiais via POST falhou devido a timeouts e HTTP 502; foi corrigida com instância Overpass Europa, queries delimitadas por bounding box e GET.
- **Não confundir** esta validação com a execução agendada de escrita real, nem com aprovação para contacto comercial. As duas dependem respetivamente de disponibilidade da fonte e de validação/autorização humana.
