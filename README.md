# Time Saver

Website em português de Portugal: **https://timesaverautomate.com/**. Código em **timesaverautomate/time-saver**, ficheiros no GitHub Pages e HTTPS, cabeçalhos e formulário no Worker Cloudflare `time-saver-edge`. A manutenção é feita pelo GitHub, sem instalar ficheiros no PC.

## Formulário de orçamento

Triagem em sete categorias: Excel/macros/VBA, automação de processos, dashboards/relatórios, tratamento de dados, integrações, aplicações à medida e “Ainda não sei”. As orientações adaptam-se à escolha. Nome, email e descrição são obrigatórios; os restantes detalhes são opcionais.

O Worker valida o pedido e envia **texto simples** pelo Resend, de `pedidos@timesaverautomate.com` para **timesaverautomate@gmail.com**. O email validado do visitante é usado apenas no Reply-To. Destinatário, remetente e assunto são fixos no servidor. Não há respostas automáticas.

**Sem base de dados de pedidos, CRM ou folhas de cálculo ligados ao formulário.** Não são guardados corpos em logs da aplicação nem em armazenamento persistente do navegador. O Resend conserva conteúdo e registos durante 30 dias, conforme o fornecedor; esta utilização foi expressamente aceite pelo titular. A caixa Gmail conserva as mensagens recebidas. Consulte [o funcionamento e operação](docs/FORMULARIO-EMAIL.md).

**Formulário operacional e verificado em 10/11/2026:** pedido submetido pelo domínio e recebido na caixa de entrada, com triagem incluída. Repetir a mesma tentativa conservou a referência e resultou numa única mensagem. SPF, DKIM e DMARC pass confirmados no Gmail. Consulte [os resultados e limites](docs/VALIDACAO.md); a mensagem apresentada ao visitante confirma aceitação pelo fornecedor, não entrega na caixa de entrada.

## Estrutura ativa

| Caminho | Função |
| --- | --- |
| `public/` | Landing page, formulário, CSS, JavaScript e recursos locais |
| `src/site-proxy.mjs` | Domínio público, cabeçalhos e acesso à origem GitHub |
| `src/contact.mjs` | API de email sem persistência de pedidos |
| `src/validation.mjs` | Validação de campos, opções e limites |
| `src/security.mjs` | Funções criptográficas partilhadas |
| `scripts/contact-html.mjs` | Informação publicada sobre privacidade e funcionamento |
| `scripts/deploy-site-domain.mjs` | Instalação nativa do Worker, segredos e contadores |
| `.github/workflows/site-domain.yml` | Publicação e verificação do Worker |
| `.github/workflows/github-pages.yml` | Testes, auditoria e publicação de ficheiros no Pages |
| `config/domain.json` | Configuração pública, sem segredos |
| `tests/` | Validação, segurança, erros, idempotência e publicação |

Os módulos antigos `src/worker.mjs`, `src/store.mjs`, `src/mail.mjs`, as migrações e o instalador antigo permanecem como referência técnica e para testes de regressão. **Não são usados pelo alojamento ativo.** O workflow antigo de instalação com D1 foi removido. O Worker ativo só recebe os quatro módulos indicados acima; não recebe qualquer ligação a D1, KV, Durable Objects ou filas.

## Publicar e verificar

Em GitHub → Actions, os workflows de domínio e Pages executam-se após alterações em `main`. O modo `contact` aguarda pela API antes de publicar os campos. A origem GitHub mantém o formulário desativado; só o domínio protegido o ativa. Não definir um domínio personalizado diretamente no GitHub Pages: a origem independente evita ciclos de redirecionamento.

Segredos em GitHub → Settings → Secrets and variables → Actions: `RESEND_API_KEY` e `CLOUDFLARE_API_TOKEN` (ou `CLOUDFLARE_SITE_API_TOKEN`). Nunca os colocar no código. A chave HMAC é criada no servidor e preservada nas atualizações. Não há compras ou alterações de plano automáticas.

Para verificar num ambiente de desenvolvimento na nuvem, com Node 24:

    npm run check
    PAGES_PUBLIC_CONTACT=true npm run build:pages

## Segurança e limites

HTTPS, HSTS, CSP, antienquadramento, validação de origem e campos no servidor, limite de 16 KiB, honeypot, ticket assinado, limites nativos de submissão e idempotência do Resend. Sem login, registo, anexos, pagamentos, chatbot, analítica ou recursos externos no navegador. Os limites agrupam os endereços IPv6 da mesma rede /64, e endereços IPv4 mapeados usam o mesmo limite do IPv4 correspondente. Os contadores Cloudflare são aproximados por localização; não constituem um limite mundial estrito. A idempotência protege a repetição da mesma tentativa durante a janela documentada; não identifica pedidos iguais iniciados em páginas novas.

Consulte também a [revisão de segurança e respetivos limites](docs/SEGURANCA.md): 87 testes aprovados na revisão aprofundada; ver relatório para estado da publicação. **TLS confirmado após a alteração na Cloudflare:** versões 1.0/1.1 recusadas no handshake e 1.2/1.3 disponíveis com certificado e hostname validados. A pendência de TLS foi resolvida e verificada em 10/11/2026 às 17:33 UTC.

## Informação jurídica

O titular pediu que não fossem publicados nome legal, NIF ou morada. Esses dados não foram inventados. As páginas publicadas descrevem o funcionamento e identificam o contacto de privacidade; **a identificação jurídica do prestador continua incompleta**. Não se declara conformidade garantida. As minutas com marcadores permanecem em `public/` para futura conclusão e não são publicadas no modo `contact`. O modo `production` e a indexação continuam bloqueados pelo preflight jurídico.

Guias antigos de D1 ou pré-lançamento descrevem versões anteriores; para a configuração atual prevalecem este README e [FORMULARIO-EMAIL.md](docs/FORMULARIO-EMAIL.md).
