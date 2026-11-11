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
