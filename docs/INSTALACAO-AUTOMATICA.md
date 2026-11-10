# Instalação automática do backend na Cloudflare

O workflow `Instalar API desativada na Cloudflare` está preparado no GitHub. Não é necessário criar pastas ou executar comandos no PC. O código público não contém os valores dos segredos.

Esta instalação mantém `MAIL_ENABLED=false`, `LEGAL_READY=false` e `API_ONLY=true`. Não publica o frontend, não ativa a recolha de pedidos, não envia emails de teste e não altera DNS, regras do domínio, planos ou faturação.

## Acesso que o titular tem de disponibilizar

A autorização dada no chat não cria uma sessão Cloudflare nem uma credencial técnica. A integração de gestão de plugins não encontrou uma ligação Cloudflare disponível nesta sessão.

1. Entrar na conta Cloudflare que vai alojar a API.
2. Abrir [My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens) e criar um token personalizado.
3. Limitar os recursos à conta pretendida e atribuir apenas as permissões de conta necessárias: **Workers Scripts: Edit**, **D1: Edit** e **Account Settings: Read**. Não usar a Global API Key. Para esta instalação não são necessárias permissões de DNS ou faturação.
4. Guardar o token diretamente em [GitHub → Settings → Secrets and variables → Actions](https://github.com/timesaverautomate/time-saver/settings/secrets/actions), opção New repository secret, com o nome **CLOUDFLARE_API_TOKEN**. Não o colar no chat, em ficheiros, issues, variáveis públicas ou logs.
5. Se o token abranger mais de uma conta, guardar o ID da conta pretendida na variável Actions **CLOUDFLARE_ACCOUNT_ID**. Sem seleção e com várias contas, a instalação para; não escolhe uma conta arbitrária.
6. Confirmar que Workers já está disponível no plano gratuito e tem um subdomínio workers.dev na conta. A instalação não aceita condições de serviço nem ativa planos pagos em nome do titular.

A chave **RESEND_API_KEY** já está guardada em Actions Secrets. O workflow copia-a para um segredo do Worker por stdin; nunca a disponibiliza ao navegador. Não é necessário partilhá-la novamente.

## O que o workflow faz

1. Executa a suite de testes e a construção sem acesso às credenciais externas.
2. Verifica o repositório estável 1452563434, o destino timesaverautomate/time-saver e a branch main.
3. Verifica a conta e o subdomínio workers.dev. Recusa sobrepor um Worker sem o identificador deste projeto ou uma API já ativa.
4. Reutiliza a base time-saver-security ou cria-a com jurisdição UE. Recusa reutilizar uma base cuja jurisdição UE não esteja confirmada. Isso não comprova que todos os tratamentos dos fornecedores ocorram no EEE.
5. Aplica as migrações técnicas, sem criar uma tabela de pedidos, e instala o Worker **time-saver-quotes** com envio desativado e observabilidade da aplicação desativada.
6. Instala a chave Resend no gestor de segredos. Gera a chave HMAC apenas se não existir; preserva-a nas reinstalações para manter os identificadores de segurança estáveis.
7. Verifica que a API responde indisponível, permite apenas a origem exata do frontend e rejeita uma origem externa. Regista o URL e o resultado no estado **time-saver/cloudflare-backend** do commit.

O Wrangler está fixado na versão 4.160.0, verificada no registo oficial npm na preparação. Os logs de disco e a telemetria do CLI estão desativados, e a sanitização permanece ativa. Ações GitHub oficiais fixadas em SHAs completos; checkout sem credenciais persistentes. Este workflow nunca é executado por pull requests.

Depois de guardar o segredo, a execução bloqueada pode ser repetida em Actions; a integração GitHub também permite repetir esse job. A instalação só se declara verificada depois de os pedidos reais à API passarem.

## Depois da instalação

O formulário comercial continua desativado. Ainda é necessário:

- Completar a identificação legal e os restantes elementos factuais das páginas legais.
- Rever contratos, acessos, retenção e transferências dos fornecedores.
- Verificar o domínio de envio no Resend e os registos SPF/DKIM; definir e testar DMARC.
- Associar o domínio ao GitHub Pages antes de apontar DNS, verificar propriedade/certificado e aplicar as regras Cloudflare. Seguir [Domínio e segurança](DOMINIO-E-SEGURANCA.md).
- Rever e ativar a configuração final do Worker num processo de publicação próprio. Este instalador recusa reexecutar numa API cujo MAIL_ENABLED já esteja true.
- Configurar QUOTE_API_ORIGIN na construção Pages, ajustar connect-src nas regras Cloudflare e testar o formulário completo, incluindo receção efetiva, duplicados, limites e falhas.

Sem estas verificações, não apresentar a API instalada como um formulário comercial operacional.

Fontes oficiais:

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/d1/wrangler-commands/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/
