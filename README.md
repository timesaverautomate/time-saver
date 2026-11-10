# Time Saver

Website profissional em português de Portugal para apresentar serviços de automação e receber pedidos de orçamento.

**Estado da entrega:** implementação e testes automáticos concluídos; envio real e publicação comercial pendentes das configurações descritas abaixo. Nenhuma compra foi efetuada. Não são necessários ficheiros no seu PC para manter ou publicar este projeto.

## Começar aqui

1. Leia [o guia de entrega e ativação](docs/ENTREGA.md): explica os passos pelo navegador, sem terminal no PC.
2. Complete [a revisão de privacidade e operação](docs/PRIVACIDADE-E-OPERACAO.md).
3. Consulte [as verificações realizadas e pendentes](docs/VALIDACAO.md).

O destinatário indicado é **timesaverautomate@gmail.com**. É configurado exclusivamente no servidor. Falta um domínio de envio verificado e uma chave de serviço de email. Não é pedida a palavra-passe do Gmail.

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

## Alojamento

**GitHub guarda o código. Cloudflare Workers executa o site e o backend.** GitHub Pages, sozinho, não executa o processamento do formulário. A implementação não depende de funcionalidades de autenticação do alojamento.

A configuração .openai/hosting.json identifica uma cópia de revisão no Sites, com armazenamento e integrações desativados. Não altera a propriedade do repositório GitHub. A publicação comercial não foi ativada. Para a instalação pública completa, siga o guia Cloudflare.
