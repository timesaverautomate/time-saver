# Teste controlado de escrita no CRM TimeSaver

O workflow **TimeSaver - pesquisar contactos B2B** foi preparado com dois modos:

- **simular** (padrão): pesquisa até 30 candidatos, consulta o Google Sheets, não escreve nem envia emails.
- **teste_escrita_2** (apenas execução manual na branch main): pesquisa candidatos novos e grava **no máximo dois** na aba **Empresas** do CRM TimeSaver_CRM_Prospeccao. Não envia emails.

O agendamento de dias úteis continua ativo apenas para **simular**, às 08:15 UTC. A escrita diária **não está ativada**. Não existe opção para escrever 30 registos em produção neste workflow.

## Como fazer o teste

1. Em GitHub Actions, selecionar **TimeSaver - pesquisar contactos B2B**.
2. Clicar **Run workflow**, manter branch **main** e selecionar **mode = teste_escrita_2**.
3. Abrir o job **pesquisar** e a etapa **Pesquisa CRM (sem envios)**.
4. Procurar a mensagem **TESTE DE ESCRITA CONFIRMADO**.
5. Abrir Google Sheets → **Empresas** e verificar as linhas adicionadas. O painel deve refletir a nova contagem se as fórmulas estiverem corretas.

Os registos ficam com **Prioridade = Por avaliar**, **Consentimento/base legal = Por avaliar**, **Não contactar = Sim** e **Notas** a indicar que a fonte OpenStreetMap não foi verificada. Não podem ser utilizados para campanhas sem revisão. Repetir o teste deve ignorar emails, domínios e identificadores OSM já registados. Se não houver candidatos novos ou as fontes falharem, o job deverá terminar com erro ou indicar zero inserções; não foi programado qualquer envio.

## Proteções

- É exigida a estrutura exata de 26 cabeçalhos no CRM.
- As pesquisas diárias não podem mudar para escrita; o script exige disparo manual, repositório, branch e workflow específicos.
- Máximo de duas linhas por teste, mesmo que a fonte devolva mais.
- Releitura antes de inserir para reduzir duplicados, com bloqueio contra execuções concorrentes do próprio workflow.
- Verificação após escrita pela chave OSM e confirmação da quantidade de linhas devolvida pelo Google Sheets.
- Sem Resend nem qualquer código de envio de mensagens neste processo.

**Limitações:** fontes OpenStreetMap podem estar indisponíveis; emails públicos e lojas não são automaticamente validados; a verificação de duplicados não substitui revisão humana; alterações ao CRM feitas por outros processos entre leitura e escrita podem gerar concorrência. O código não constitui validação da base legal de prospeção.

## Antes de habilitar escrita diária

Rever a qualidade e exatidão dos contactos, critérios comerciais, fontes e condições de utilização; definir política de exclusão e base legal; adicionar logs de auditoria apropriados; validar um teste com no máximo duas empresas; e só então criar uma etapa separada com limites e aprovação explícita para escrita automática. Os emails comerciais mantêm-se fora do âmbito deste workflow.
