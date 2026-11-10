# Domínio e segurança — timesaverautomate.com

O titular indicou timesaverautomate.com, com DNS na Cloudflare, e autorizou tornar público o repositório timesaverautomate/time-saver para usar GitHub Pages gratuito. Após a confirmação do titular, a leitura do repositório e da API Pages em 10 de novembro confirmou visibilidade pública e build_type workflow. Pages está ativado, com HTTPS obrigatório no endereço GitHub, mas ainda sem uma publicação bem-sucedida ou domínio personalizado associado.

## Estado confirmado e preparação

Em 10 de novembro de 2026, os servidores DNS observados foram elle.ns.cloudflare.com e clark.ns.cloudflare.com. A consulta pública à raiz do domínio não devolveu A, AAAA, CNAME, MX, TXT ou CAA. Nenhum registo foi alterado nesta preparação.

O acesso administrativo à nova conta/repositório GitHub foi confirmado. A integração permite editar código e workflows, mas não tem operações para alterar a visibilidade, ativar Pages ou gerir a zona Cloudflare. O acesso da linha de comandos pertence a outra conta; a leitura pública não confere autorização para mudar as definições administrativas.

As ações oficiais foram fixadas em SHAs completos de releases verificadas. Os checkouts não persistem credenciais. O teste Resend só corre em main. O job de publicação tem apenas as permissões Pages/OIDC necessárias. Pull requests públicos não recebem a chave Resend.

A execução [42841836621](https://github.com/timesaverautomate/time-saver/actions/runs/42841836621) aprovou 31 testes e verificou 13 commits/68 blobs de texto sem encontrar os padrões procurados. Confirmou Pages não configurado/acessível (HTTP 404) e omitiu a publicação. O repositório continuava privado na leitura após esse workflow. Mais tarde, o titular alterou-o para público e ativou Pages: a nova consulta GET /repos/timesaverautomate/time-saver/pages respondeu HTTP 200, build_type workflow, cname null e https_enforced true. Essa verificação antecedeu a publicação. Posteriormente, o modo de pré-lançamento foi publicado com sucesso e GET https://timesaverautomate.github.io/time-saver/ respondeu 200 por HTTPS, sem formulário. O modo comercial aguarda os dados legais. As consultas DNS à raiz e ao CNAME www continuavam sem registos de destino.

O workflow Pages verifica padrões de credenciais no histórico Git completo sem imprimir os valores. A auditoria é heurística; não garante ausência de todos os tipos de segredo. Existem testes que verificam deteção de uma credencial removida do ficheiro atual mas ainda presente no histórico.

## Código público

Código público é compatível com um site seguro quando os segredos e os controlos ficam no servidor. Tornar o repositório público expõe também a documentação e o histórico.

Guardar chaves em GitHub Actions Secrets ou no gestor de segredos do backend. Não colocar valores no frontend, em ficheiros .env versionados, documentação ou logs. Um colaborador que pode alterar workflows também pode afetar o uso dos segredos: restringir colaboradores e ativar MFA nas contas de gestão.

Rever a proteção de segredos e push protection disponibilizadas pelo GitHub e manter as versões fixadas das ações atualizadas. Nenhum plano pago foi contratado.

## Ordem de configuração segura

1. Concluído: auditoria sem os padrões de segredo procurados e repositório tornado público pelo titular.
2. Concluído: GitHub Actions selecionado como Source. Continua a faltar o deploy, bloqueado pelos dados legais por preencher.
3. Na conta GitHub, verificar a propriedade do domínio em Settings → Pages usando o TXT exato fornecido pelo GitHub. O TXT é público e pode ser partilhado; não é uma chave de API.
4. Guardar timesaverautomate.com como Custom domain no repositório antes de apontar o DNS.
5. Configurar os registos abaixo, preservando registos existentes com outras finalidades.
6. Confirmar o certificado GitHub Pages e ativar Enforce HTTPS.
7. Só depois de confirmar o certificado de origem, configurar o proxy Cloudflare, Full (strict), encaminhamento HTTPS e cabeçalhos.

O preflight mantém a publicação comercial bloqueada enquanto faltarem os dados legais. O pedido posterior de publicação imediata é tratado como pré-lançamento explícito: sem formulário, sem minutas incompletas publicadas e sem indexação. As minutas comerciais não são apagadas nem se preenchem com dados inventados. Uma revisão técnica não substitui a aprovação factual da informação.

## DNS do site

Valores oficiais do GitHub na data da preparação:

| Tipo | Nome | Conteúdo | Proxy inicial |
| --- | --- | --- | --- |
| A | @ | 185.199.108.153 | DNS only |
| A | @ | 185.199.109.153 | DNS only |
| A | @ | 185.199.110.153 | DNS only |
| A | @ | 185.199.111.153 | DNS only |
| CNAME | www | timesaverautomate.github.io | DNS only |

Não incluir /time-saver no CNAME nem criar wildcard. Não remover MX/TXT de email entretanto criados. A verificação de propriedade e a associação prévia no GitHub reduzem o risco de terceiros reclamarem o domínio.

O domínio principal pretendido é https://timesaverautomate.com, com www a encaminhar para ele.

## Cabeçalhos e HTTPS

config/cloudflare-security-headers.json contém um modelo, ainda por aplicar numa regra de resposta da Cloudflare para os hosts do site. Um ficheiro no GitHub não altera os cabeçalhos HTTP.

O modelo inclui CSP, frame-ancestors none, X-Frame-Options DENY, nosniff, Referrer-Policy e Permissions-Policy. Quando o backend real for ativado, ajustar connect-src e form-action para permitir apenas o necessário.

Confirmar TLS 1.2 ou superior, Full (strict) com certificado de origem válido e encaminhamento permanente para HTTPS. Ativar HSTS apenas depois da verificação real; o modelo não inclui includeSubDomains nem preload.

GitHub Pages sozinho não oferece a mesma configuração de cabeçalhos que o Worker. A CSP por meta não suporta frame-ancestors e não substitui os cabeçalhos HTTP. As regras Cloudflare só produzem efeito quando aplicadas e com tráfego pelo proxy.

Não foram adicionados pixels, analítica, publicidade ou desafios externos. Se forem acrescentadas tecnologias de proteção no navegador, avaliar acessibilidade e privacidade e rever o inventário de cookies real.

## Instalação automática preparada

O workflow cloudflare-backend.yml instala apenas a API desativada, sem depender de publicar o frontend comercial. Requer uma credencial Cloudflare guardada em Actions Secrets, que não está disponível pelo simples facto de o titular autorizar a ação no chat. O procedimento e as permissões mínimas estão em [INSTALACAO-AUTOMATICA.md](INSTALACAO-AUTOMATICA.md). O workflow não altera DNS nem regras Cloudflare.

## Email e formulário

O teste Resend para timesaverautomate@gmail.com foi aceite e a receção foi confirmada pelo titular. O remetente resend.dev serviu apenas para esse teste.

Adicionar e verificar o domínio/subdomínio no painel Resend; aplicar SPF/DKIM exatos desse painel e avaliar DMARC/alinhamento. Não inventar chaves/seletores DKIM nem criar dois SPF no mesmo nome. A chave existente de envio não concede automaticamente gestão de domínios Resend ou DNS Cloudflare.

O código suporta backend separado em modo API_ONLY, CORS de origem exata, preflight limitado e endpoint HTTPS explícito no cliente. GitHub Pages não executa esse backend. O formulário fica desativado até existir um backend adequado, segredo no servidor, remetente verificado, dados legais completos e teste real do fluxo. A chave não será incluída nos ficheiros públicos.

O contacto de privacidade autorizado pelo titular é timesaverautomate@gmail.com e já foi aplicado na Política de Privacidade. O nome/denominação legal, NIF/NIPC, morada profissional e as condições dos fornecedores ainda não foram confirmados.

## Verificações pendentes

Confirmar publicação, DNS, propriedade do domínio, certificados, redirecionamentos, cabeçalhos efetivos, cookies e utilização por teclado/telemóvel. Verificar no servidor entradas inválidas, limites, duplicados, falhas do serviço de email e receção real.

As contas operacionais precisam de MFA, permissões mínimas e manutenção. Não se declara segurança absoluta ou certificação.

Fontes:

- https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- https://resend.com/docs/dashboard/domains/introduction
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits

## Atualização verificada da instalação

A execução 42849491105 publicou o pré-lançamento com sucesso. A execução Cloudflare 42849491178 registou o subdomínio de conta em falta e depois recebeu HTTP 401 na operação d1_database. A conta tem agora um endereço workers.dev, mas isso não significa que o Worker tenha sido instalado. Rever D1: Edit e o âmbito da conta na credencial; não publicar o valor. O domínio próprio e as regras Cloudflare continuam pendentes.
