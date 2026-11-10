# TimeSaver — Pesquisa e atualização controlada do CRM

## Estado — escrita diária não ativada

A pesquisa B2B está programada para dias úteis, às 08:15 UTC (08:15 de inverno e 09:15 de verão em Portugal, podendo haver atrasos no GitHub Actions). O script pesquisa empresas em fontes OpenStreetMap; encontrar 30 empresas por dia não é garantido, sobretudo se as fontes estiverem indisponíveis ou não publicarem email comercial genérico.

### Modos

- simular: modo padrão, não grava nem envia emails.
- teste_escrita_2: acionamento manual na branch main, grava no máximo 2 novos candidatos, sempre com bloqueio de contacto.
- diario: só eventos agendados, branch main e repositório TimeSaver, com variável GitHub Actions CRM_DAILY_WRITE_ENABLED definida exatamente como true. Não está disponível no menu manual.

Sem a variável CRM_DAILY_WRITE_ENABLED=true, a execução diária continua em SIMULAÇÃO. Nenhuma alteração foi feita às variáveis do repositório para ativá-la.

### Proteções

1. Validação dos 26 cabeçalhos da aba Empresas antes de qualquer escrita.
2. Pesquisa em fontes OSM e apenas emails genéricos de negócios; exclusão de webmail comum. Os dados não são verificados como verdadeiros.
3. Deduplicação por nome e localidade, email, domínio e identificador OSM; releitura do CRM imediatamente antes de gravar.
4. Limite de 30 novas linhas automáticas por dia em Europe/Lisbon. A coluna Notas recebe o marcador TSCRM_AUTO_DATE=AAAA-MM-DD; repetição no mesmo dia desconta registos já inseridos. As duas linhas antigas do teste manual não têm este marcador e não entram na quota automática.
5. Registos sempre com Não contactar = Sim, base legal = Por avaliar e campos de envio vazios. Nenhum email é enviado, nem há dependência Resend neste workflow.
6. Execuções do mesmo workflow serializadas; a API Sheets não fornece transação atómica face a outros programas ou edição simultânea. Não apagar o marcador de importação nas notas.
7. Após append, o script valida quantidade inserida e unicidade dos identificadores; resposta inconclusiva obriga a rever o CRM antes de repetir.
8. Alterações ao código no GitHub disparam testes Python em job isolado, sem credenciais de Google e sem escrita na folha.

### Antes da ativação

- Validar a nova suite de testes no GitHub Actions.
- Confirmar uma simulação com o código novo e rever amostras de empresas e emails na folha.
- Validar políticas de utilização das fontes, privacidade, critérios de relevância e base legal para armazenar/tratar os dados.
- Confirmar ausência de contactos enviados e a lista de exclusão.
- Apenas quando todas as validações forem satisfatórias: Settings > Secrets and variables > Actions > Variables > CRM_DAILY_WRITE_ENABLED = true.

Não mudar a variável enquanto houver pendências. A automação é exclusivamente de pesquisa e atualização do CRM e não de campanhas de email.
