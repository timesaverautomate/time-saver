# Verificações realizadas e pendentes

> Atualização de 10 de novembro de 2026: o teste técnico real do serviço Resend foi aceite e o titular confirmou a receção na caixa de entrada de timesaverautomate@gmail.com. [Execução verificada](https://github.com/usertechsitee/time-saver/actions/runs/42829562752) e [procedimento](TESTE-EMAIL.md). A chave permanece em GitHub Actions. A submissão através do formulário, a configuração no alojamento, o remetente de produção e os requisitos legais continuam pendentes. O relatório abaixo conserva o alcance das verificações originais.

Data: 10 de novembro de 2026. Estes resultados correspondem ao código entregue, não a um serviço de email ou domínio de produção já configurado.

## Executado

Comando: npm run check, com Node 24.22.1 e SQLite nativo.

**19 testes automáticos aprovados.** O teste de fornecedor usa respostas de teste; não enviou mensagens reais.

| Verificação | Resultado e alcance |
| --- | --- |
| Construção do Worker | Recursos locais e módulos compilados, sem dependências de produção |
| Falta de credenciais ou dados legais | Estado indisponível; POST devolve falha, sem sucesso simulado |
| Pedido válido | Aceitação do fornecedor de teste, referência, data, destinatário fixo, From fixo e Reply-To validado |
| Dados inválidos | Tipos, opções, limites, email e injeção de campos rejeitados pelo servidor |
| Origem e proteção temporária | Origem externa/ausente, token inválido, token expirado e envio imediato rejeitados |
| Honeypot e limite do corpo | Rejeição de honeypot preenchido, corpo excessivo, tipo errado e JSON inválido |
| Idempotência | Mesma chave e mesmo conteúdo com outra chave não originam novo envio na janela técnica |
| Concorrência | Duas submissões concorrentes do mesmo pedido originam apenas uma chamada ao fornecedor de teste |
| Falha do email | Erro, timeout, rejeições HTTP e resposta sem ID não mostram sucesso |
| Nova tentativa | Referência e corpo preservados após falha do fornecedor |
| Limites partilhados | Contador SQLite atómico e rejeição de excesso no endpoint |
| Limpeza | Registos expirados eliminados; bloqueios válidos preservados |
| Base técnica | Não contém nome, email, IP em claro ou mensagem |
| Tratamento de conteúdo | Conteúdo potencialmente malicioso tratado como texto no email, sem interpolação na página |
| Cabeçalhos | CSP, antienquadramento, nosniff, ausência de cookies criados pela aplicação e HSTS condicionado |
| Falha de infraestrutura | Falha fechada quando faltam IP do edge ou acesso à base; sem detalhes internos na mensagem |
| Contas e áreas privadas | /login, /registo, /admin, /conta, /reset-password e /api/login devolvem 404 no Worker |
| Estrutura HTML | Idioma pt-PT, h1 único, âncoras válidas, labels, mensagens associadas e recursos existentes |
| Frontend | Sem segredos, mailto de submissão, armazenamento persistente, inputs de passwords ou anexos |
| Acessibilidade e responsividade no código | Foco visível, redução de movimento e layouts responsivos presentes; não equivale a verificação em navegador |

Também executado: npm run preflight. **Falha esperada**, devido aos marcadores legais. É o comportamento pretendido antes de completar os dados.

O PNG de partilha foi gerado a partir do SVG original. A sua apresentação em redes sociais depende do URL definitivo e permanece por testar.

## Não executado / depende de configuração

- **Submissão e receção efetiva no Gmail:** falta domínio de remetente verificado e credencial de envio.
- Verificação real de SPF, DKIM, DMARC, spam, rejeições e devoluções.
- Limites e idempotência no serviço D1 e Resend reais, incluindo semântica e janela do fornecedor.
- Verificação do cron, acessos mínimos, MFA, retenção e eliminação nas contas reais.
- HTTPS, redirecionamentos, cabeçalhos finais, HSTS e origem exata no domínio final.
- Contratos, dados legais, RAL, Livro de Reclamações, retenção aprovada e transferências internacionais.
- Cookies efetivos introduzidos pelo alojamento e por mecanismos do edge.
- Indexação, URL canónico e imagem Open Graph absoluta após definir o domínio.
- **Revisão visual e interação em navegador:** não foi disponibilizada a ferramenta de controlo do navegador neste ambiente. Não foi instalada uma alternativa para contornar essa limitação.
- Navegação por teclado completa, leitores de ecrã, contraste medido e auditoria WCAG 2.2 AA. Acessibilidade é um objetivo técnico, não uma certificação obtida.

Contexto da limitação de navegador: ambiente ccarenv_b64_Y2NhcmVudl81YzhhZWVkZjA4MDQ4MTkxYTMyYjJlNmMwNzE3MjNmMQ, ligado e pronto para comandos; desktop anunciado como enabled com estado unknown, mas sem ferramenta cua_repl.js oferecida à sessão.

## Guião de validação manual

1. Em larguras de 320/375/768/1024/1440 px, confirmar ausência de cortes, sobreposição e deslocação horizontal. Aumentar texto e zoom a 200% e 400%.
2. Percorrer a página com Tab e Shift+Tab; testar o salto para conteúdo, menu móvel, Escape, acordeões, tabs com setas/Home/End e links internos.
3. Num leitor de ecrã, confirmar título e ordem das secções, nome acessível do logótipo, palavra “tempo”, labels, obrigatoriedade, estado indisponível e mensagens de erro/sucesso.
4. Ativar redução de movimento e confirmar que as animações param. Medir contraste dos estados normais, hover, erro, foco e desativado.
5. Com envio configurado num ambiente de teste, submeter campos vazios, email inválido, descrição curta e opções inválidas. Confirmar erros junto aos campos e manutenção dos dados.
6. Em falha de rede ou fornecedor, confirmar manutenção dos dados, nova tentativa e ausência de mensagem de sucesso. Confirmar receção real e apenas um email para tentativas repetidas.
7. Fechar/recarregar a página e verificar que o código da aplicação não recupera os campos de armazenamento persistente. Distinguir preenchimento automático do navegador.
8. Inspecionar cookies e armazenamento numa sessão limpa. Registar tecnologias do alojamento, finalidades e duração, e avaliar consentimento antes de acrescentar qualquer banner.
9. Abrir as rotas de autenticação e confirmar 404. Confirmar ausência de chamadas de terceiros no browser, salvo infraestrutura explicitamente avaliada.
10. Registar quem validou, em que data, navegador, dispositivo e resultado. Não converter estes pontos em “aprovado” sem os executar.
