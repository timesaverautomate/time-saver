# Verificações realizadas e pendentes

> **Domínio concluído:** execução 42853443010 (commit 9ec9f07ac47da506187703546bb27f29b3967dfb) terminou com sucesso: 50 testes, pesquisa heurística de segredos em 21 commits/131 blobs de texto sem ocorrências dos padrões procurados, Worker instalado, domínio e www associados e HTTPS/cabeçalhos verificados. Não foram alterados planos pagos nem ativado um formulário.

> **Pedidos reais verificados no domínio:** início, CSS, JavaScript, PNG e três páginas informativas responderam 200; login, admin e api/quote responderam 404. POST api/quote respondeu 405. HTTP e www responderam 308 para https://timesaverautomate.com/. CSP, HSTS de um ano, DENY, nosniff, políticas de referência/permissões, COOP e CORP foram confirmados. A imagem PNG recebida tem o mesmo SHA-256 do ficheiro de origem. Nas respostas inspecionadas não houve Set-Cookie.

> **Renderização dos recursos públicos:** Chromium a 375 e 1440 px, menu móvel, teclado e demonstração aprovados, sem erros JavaScript, recursos falhados ou pedidos a terceiros. O Chromium do ambiente não confia diretamente na CA de inspeção do proxy da plataforma; os recursos reais foram obtidos pelo cliente HTTP com validação TLS e fornecidos à renderização por interceção de pedidos. Não se desativou a validação TLS do cliente HTTP. O certificado público foi também validado diretamente pela execução GitHub Actions. A validação local anterior a 320/375/768/1440 px mantém o alcance indicado abaixo.

> **Decisão do titular:** não fornecer dados legais. A versão mantém-se informativa e sem recolha de pedidos. Não foram inventadas identidades, ativado email, obtida certificação de segurança ou validada conformidade legal integral. Os itens comerciais do historial abaixo não impedem este modo de apresentação.

> Verificação adicional no motor workerd, através do Miniflare instalado com o Wrangler: o proxy respondeu 200 com origem de teste e reescrita ativa. Foi corrigida uma incompatibilidade de runtime: Workers usa redirect manual; respostas 3xx são recusadas explicitamente pelo proxy. O teste de regressão inclui uma origem que tenta redirecionar para outro destino. A emissão/ligação dos certificados da Cloudflare já foi observada por HTTPS, mas o serviço completo só fica verificado após o deploy corrigido.

> Preparação do domínio informativo: 50 testes locais aprovados. Os dez testes adicionais verificam proxy fechado, caminhos/metadados, cabeçalhos, ausência de cópia de credenciais, preservação de PNG/HEAD, TLS antigo, rejeição de formulários inesperados, conflitos de domínio/Worker, HSTS após verificação e resultados parciais. A publicação real do Worker e dos certificados fica por confirmar até executar o novo workflow.

> Verificação final desta publicação: o workflow 42849491105 concluiu os jobs build, inspect e deploy com sucesso. Página inicial, CSS, JavaScript, logótipo, imagem de partilha e três páginas informativas responderam HTTP 200 por HTTPS; /login respondeu 404. Os recursos verificados não continham nomes das credenciais de servidor. No workflow separado 42849491178, o registo de workers.dev foi ultrapassado, mas o acesso ao D1 recebeu HTTP 401; não foi declarada instalação da API ou envio operacional. É necessário rever a permissão D1: Edit e o âmbito da conta. Este resultado não verifica o domínio personalizado, SPF/DKIM/DMARC ou cabeçalhos Cloudflare.

> Publicação verificada: a execução GitHub Actions 42849003760 publicou o commit 6a64a7d7c01528e0be88fc206d5a77d0e36ff626 com sucesso. GET https://timesaverautomate.github.io/time-saver/ respondeu HTTP 200 por HTTPS, com a indicação de pré-lançamento, CSP por meta e sem formulário. O domínio próprio, o formulário e os cabeçalhos Cloudflare não ficam verificados por este resultado. A credencial Cloudflare foi aceite na descoberta da conta; o erro observado a seguir foi HTTP 404 na consulta workers_subdomain. O instalador foi atualizado para registar o endereço gratuito em falta, sem mudar planos. O teste adicional deste caso passou (40 testes no total).

> QA do pré-lançamento executada em Chromium headless com Playwright: larguras 320, 375, 768 e 1440 px, sem deslocação horizontal. Verificados salto por teclado, menu móvel, mudança da demonstração, abertura de FAQ por teclado, ausência de campos de recolha, três rotas informativas com HTTP 200 e ausência de erros JavaScript. Capturas desktop/telemóvel inspecionadas. Este resultado refere-se à exportação local de pré-lançamento; não verifica o formulário comercial, leitores de ecrã ou uma certificação WCAG.

> Pré-lançamento público: 39 testes locais aprovados. As verificações adicionais confirmam que o modo preview não exporta formulários ou marcadores legais, força ausência de API/indexação e mantém as minutas de origem inalteradas. O modo production continua bloqueado. A publicação e os pedidos HTTP ao endereço público só serão considerados verificados depois de executar o deploy. A credencial Cloudflare foi detetada na nova tentativa, mas o fornecedor recusou uma operação; o instalador passa a registar apenas a categoria da operação e o código HTTP, sem valores ou respostas internas.

> Preparação adicional: 37 testes locais aprovados, incluindo seis testes do instalador Cloudflare. Verificam bloqueio antes de chamadas externas sem credenciais, destino main/repositório, preservação de HMAC, recusa de Worker alheio ou ativo, jurisdição da base, CORS restrito e ausência de valores secretos nos resultados. O Wrangler 4.160.0 também compilou o Worker em modo dry-run, sem publicar ou criar recursos. A instalação real continua dependente de acesso Cloudflare e do resultado do novo workflow; não confundir os testes com esse acesso.

> Atualização verificada em GitHub Actions: 31 testes aprovados e construção estática concluída. A auditoria do commit 4ff59cec4ad8c2c564a56a92c536c135f42ea112 percorreu 13 commits e 68 blobs de texto sem encontrar os padrões de segredos procurados. É uma pesquisa heurística, não uma garantia absoluta. [Execução e resultados](https://github.com/timesaverautomate/time-saver/actions/runs/42841836621).

> Atualização após intervenção do titular: repositório confirmado público e API Pages respondeu 200 com build_type workflow e https_enforced true. Ainda sem domínio personalizado (cname null); o URL do site devolveu 404, pelo que não se declara publicação concluída. As consultas DNS não devolveram A para a raiz nem CNAME para www. Nenhum registo DNS ou regra Cloudflare foi alterado.

> Atualização de 10 de novembro de 2026: o teste técnico real do serviço Resend foi aceite e o titular confirmou a receção na caixa de entrada de timesaverautomate@gmail.com. [Execução verificada](https://github.com/timesaverautomate/time-saver/actions/runs/42829562752) e [procedimento](TESTE-EMAIL.md). A chave permanece em GitHub Actions. A submissão através do formulário, a configuração no alojamento, o remetente de produção e os requisitos legais continuam pendentes. O relatório abaixo conserva o alcance das verificações originais.

Data: 10 de novembro de 2026. Estes resultados correspondem ao código entregue, não a um serviço de email ou domínio de produção já configurado.

## Executado

Comando: npm run check, com Node 24.22.1 e SQLite nativo.

**31 testes automáticos aprovados na versão atual**, incluindo os 19 testes da entrega inicial e verificações adicionais de CORS, exportação Pages e deteção de segredos no histórico. O fornecedor é substituído por respostas de teste nesta suite; o teste técnico real Resend, indicado acima, é uma verificação separada.

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

- **Submissão através do formulário e receção efetiva no Gmail:** falta backend publicado com D1, remetente de domínio verificado e credencial de envio configurada nesse backend. A chave já está guardada em GitHub Actions e o teste técnico isolado foi recebido; isso não valida o formulário.
- Verificação real de SPF, DKIM, DMARC, spam, rejeições e devoluções.
- Limites e idempotência no serviço D1 e Resend reais, incluindo semântica e janela do fornecedor.
- Verificação do cron, acessos mínimos, MFA, retenção e eliminação nas contas reais.
- HTTPS, redirecionamentos, cabeçalhos finais, HSTS e origem exata no domínio final.
- Contratos, dados legais, RAL, Livro de Reclamações, retenção aprovada e transferências internacionais.
- Cookies efetivos introduzidos pelo alojamento e por mecanismos do edge.
- Indexação, URL canónico e imagem Open Graph absoluta após definir o domínio.
- **Revisão do formulário comercial em navegador:** permanece pendente. A apresentação pública de pré-lançamento foi agora verificada em Chromium/Playwright, conforme descrito acima; não inclui formulário.
- Navegação por teclado completa, leitores de ecrã, contraste medido e auditoria WCAG 2.2 AA. Acessibilidade é um objetivo técnico, não uma certificação obtida.

Na entrega inicial da versão Sites não estava disponível a ferramenta de desktop desse fluxo. Na publicação atual em GitHub Pages, a validação automatizada da exportação foi executada com o Chromium e o Playwright disponíveis no ambiente de desenvolvimento.

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
