# TimeSaver — regras permanentes de organização do CRM (13/11/2026)

Livro Google Sheets: https://docs.google.com/spreadsheets/d/1VYEBWJb_9cYGbO8nZa3d_qh1rLUH-H3xf-w4CnOLMS4/edit

## Aba `Candidaturas chat` (gid 661961457)

**Destino exclusivo das oportunidades de projeto encontradas e das candidaturas a trabalhos nas plataformas.**
- As pesquisas de pedidos públicos entram aqui, após deduplicação pelo link.
- Preservar os 11 cabeçalhos atuais: Projeto, Plataforma, Link do anúncio, Publicado, Necessidade, Adequação, Estado, Próxima ação, Candidatura feita?, Entrada no CRM, Novo hoje?
- Uma candidatura preparada, mas não submetida, mantém `Candidatura feita? = Não`.
- Marcar `Sim` apenas com confirmação efetiva da candidatura na plataforma, juntando prova/data nas notas ou estado.
- Não misturar emails comerciais nem criar duplicados.

## Aba `Pedidos chat` (gid 1877467612)

**Destino dos emails comerciais gerados/enviados pelo chat e do espelho dos envios comerciais realmente confirmados pelo sistema.**
- As propostas/rascunhos inseridos pela tarefa de pesquisa de pequenas empresas ficam com `Por enviar`; abrir um `mailto:` não equivale a enviar.
- Ao enviar efetivamente pela integração Gmail ou outra origem, registar destinatário, empresa, data/hora, estado e comprovativo do fornecedor (quando fornecido); nunca escrever `Enviado` sem confirmação.
- O workflow `.github/workflows/sync-chat-emails.yml` sincroniza, após o envio, as mensagens já confirmadas que tenham sido registadas no separador técnico `Pedidos`; deduplica pelo ID da mensagem e não envia emails.
- O script `scripts/sync_chat_sent.py` só regista mensagens de 13/11/2026 em diante com data de último envio, contador positivo e identificador de fornecedor; não regista reservas, rascunhos ou mensagens sem ID.
- O espelho guarda o identificador e estado da API; não inventa data de entrega, leitura ou o conteúdo original quando este não estiver arquivado.

## Restantes separadores mantêm a finalidade própria

- `Pedidos`: livro técnico de prospeção e envio com controlos de consentimento, oposição, quotas e duplicados. **Não eliminar nem substituir**, pois os scripts Gmail/Resend dependem da identidade e linha.
- `Revisão Comercial`: autorização e verificação legal/comercial, sem aprovações automáticas.
- `Pedidos do Site`: formulários reais de orçamento recebidos no site; nunca misturar com cold outreach, candidaturas ou emails enviados.

## Teste

GitHub Actions: https://github.com/timesaverautomate/time-saver/actions/runs/43465024943

- 88 testes unitários passaram.
- Consulta real das duas abas e do `Pedidos` em modo pré-visualização: **0 envios elegíveis por sincronizar** nesse instante.
- Esta validação não executou envios Gmail nem Resend nem gravou novas linhas na aba `Pedidos chat`.
- Em dias úteis o espelho de emails corre às 17:15 UTC; as tarefas ChatGPT guardam diretamente os respetivos registos nos separadores acima.
