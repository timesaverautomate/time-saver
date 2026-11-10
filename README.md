# Time Saver

Website profissional em português de Portugal para apresentar serviços de automação e receber pedidos de orçamento.

**Site público:** https://timesaverautomate.com/ — domínio ligado e verificado por HTTPS (HTTP 200), com www/HTTP a encaminhar para o endereço principal. Ficheiros alojados no GitHub Pages e protegidos pelo Worker Cloudflare time-saver-edge. Sem formulário ou recolha de pedidos. Código e testes automáticos preparados; teste operacional Resend recebido e confirmado. O domínio próprio está ligado. Por decisão do titular, a apresentação continua sem formulário ou recolha comercial e sem dados legais inventados. Não se declara conformidade legal garantida. Nenhuma compra foi efetuada. Não são necessários ficheiros no seu PC para manter ou publicar este projeto.

## Começar aqui

O repositório foi transferido para **timesaverautomate/time-saver**. O domínio indicado é **timesaverautomate.com**, com DNS na Cloudflare. Consulte [o guia de GitHub Pages](docs/GITHUB-PAGES.md) e [a preparação do domínio e segurança](docs/DOMINIO-E-SEGURANCA.md).

1. Leia [o guia de entrega e ativação](docs/ENTREGA.md): explica os passos pelo navegador, sem terminal no PC.
2. Complete [a revisão de privacidade e operação](docs/PRIVACIDADE-E-OPERACAO.md).
3. Consulte [as verificações realizadas e pendentes](docs/VALIDACAO.md).
4. Para instalar o backend pelo GitHub, siga [a instalação automática na Cloudflare](docs/INSTALACAO-AUTOMATICA.md). O instalador mantém o envio desativado e requer uma credencial de gestão guardada diretamente em Actions Secrets.

O destinatário indicado é **timesaverautomate@gmail.com**. É configurado exclusivamente no servidor. Falta verificar o domínio de envio e configurar no backend a credencial já guardada em GitHub Actions. Não é pedida a palavra-passe do Gmail.

## O que inclui

- Landing page adaptável a telemóvel, tablet e computador.
- Logótipo original em caminhos SVG e lettering vetorial da palavra “tempo”, mantendo texto acessível para leitores de ecrã.
- Demonstração interativa de três processos, seis serviços, cinco exemplos ilustrativos, processo em quatro passos e perguntas frequentes.
- Formulário com detalhes opcionais expansíveis, validação e estados de envio.
- Backend Cloudflare Worker com envio real através da API Resend, apenas quando configurado.
- Proteções partilhadas em D1 contra excesso de pedidos e duplicados. Sem base de dados de pedidos.
- Política de Privacidade, Aviso Legal e informação sobre cookies para completar.
- Sem contas, login, pagamentos, subscrições, newsletter, chatbot, anexos ou analítica.
- Sem bibliotecas de produção nem recursos de terceiros no navegador.

## Estrutura

| Caminho | Conteúdo |
| --- | --- |
| public/ | HTML, CSS, JavaScript e SVG locais |
| src/worker.mjs | Rotas, validação de origem e submissão |
| src/validation.mjs | Formatos, tipos, opções e limites |
| src/mail.mjs | Configuração e envio de email exclusivamente no servidor |
| src/security.mjs | Cabeçalhos, HMAC e códigos temporários |
| src/store.mjs | Contadores e bloqueios atómicos em D1 |
| migrations/ | Esquema técnico, sem nomes, emails ou mensagens |
| scripts/build.mjs | Compilação determinística para um único Worker |
| scripts/preflight.mjs | Bloqueio de publicação com marcadores legais |
| tests/ | Testes Node com SQLite real e fornecedor de email substituído por um serviço de teste |
| docs/ | Configuração, privacidade, operação e validação |

## Desenvolvimento técnico

Requer Node.js 22.13 ou superior, recomendado Node 24. Não há dependências a instalar para construir ou testar:

    npm run check
    npm run build
    npm run preflight

O preflight **falha intencionalmente na entrega**, porque faltam os dados legais. A sua aprovação não equivale a uma auditoria jurídica.

A construção junta os módulos e os recursos de public/ em dist/server/index.js. O ficheiro de recursos importado em src/worker.mjs é resolvido pelo construtor; não execute esse módulo de origem diretamente.

Para desenvolvimento num ambiente na nuvem, é possível usar Wrangler com um ambiente de teste e D1 local. Consulte primeiro as condições da ferramenta e da plataforma. Nunca coloque segredos no código ou no navegador.

## Alojamento escolhido: GitHub Pages

O frontend está preparado para GitHub Pages, com recursos locais e caminhos adaptados ao projeto ou ao domínio personalizado. O domínio público verificado é https://timesaverautomate.com. A origem GitHub permanece independente em https://timesaverautomate.github.io/time-saver/, para ser consultada pelo Worker por HTTPS.

    npm run build:pages

O workflow de Pages constrói uma revisão, audita padrões de segredos no histórico e verifica a configuração de alojamento. A publicação comercial permanece bloqueada pelos marcadores legais. O modo explícito preview publica uma apresentação de pré-lançamento sem campos de recolha, sem os documentos legais incompletos e sem indexação; as minutas completas permanecem no código para revisão. O titular tornou o repositório público e ativou Pages com origem GitHub Actions, confirmado pela API. A publicação de pré-lançamento foi concluída com sucesso. O bloqueio de dados legais permanece ativo para o modo production.

O backend é separado, porque GitHub Pages não executa funções de servidor. O Worker suporta API dedicada, CORS para a origem exata, validação, limites partilhados e proteção contra duplicados. Na exportação estática, o formulário permanece desativado até configurar um endpoint HTTPS real em QUOTE_API_ORIGIN e o backend confirmar disponibilidade. A chave Resend fica no servidor.

As ações oficiais estão fixadas em SHAs completos. Os cabeçalhos do domínio foram aplicados pelo Worker e verificados em respostas reais: CSP, HSTS, antienquadramento, nosniff, política de referência e permissões, COOP e CORP. O controlo da aplicação rejeita TLS 1.0/1.1; não se afirma ter alterado a definição global da zona. O repositório público não contém os valores dos segredos de Actions.

A versão privada antiga no Sites mantém-se como referência de revisão enquanto o alojamento de destino está por concluir.

Backend de orçamento inativo: a credencial permitiu registar o endereço de conta workers.dev em falta. A instalação parou depois com HTTP 401 ao aceder ao D1. Rever a permissão de conta D1: Edit e o âmbito da conta no token; não divulgar o valor. O Worker de orçamento ainda não está instalado nem operacional.

O titular optou por não fornecer dados legais. O site público mantém-se como apresentação de pré-lançamento, sem recolha de pedidos. A ligação do domínio e os controlos HTTP passam a usar o Worker time-saver-edge em frente à origem GitHub Pages; consultar [o procedimento do domínio público](docs/DOMINIO-PUBLICO.md). Este Worker não usa D1 ou Resend.

**Validação do domínio concluída:** workflow 42853443010, commit 9ec9f07ac47da506187703546bb27f29b3967dfb. HTTPS, redirecionamentos e cabeçalhos verificados. 50 testes aprovados; origem e domínio sem formulário. O bloqueio D1 do backend de orçamento não afeta este site informativo. Consulte [o relatório](docs/VALIDACAO.md).
