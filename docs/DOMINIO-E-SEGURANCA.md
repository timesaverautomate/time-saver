# Domínio e segurança — timesaverautomate.com

O titular indicou timesaverautomate.com, com DNS na Cloudflare, e autorizou tornar público o repositório timesaverautomate/time-saver para usar GitHub Pages gratuito. Essa autorização não comprova que a visibilidade ou as definições de alojamento já tenham sido alteradas.

## Estado confirmado e preparação

Em 10 de novembro de 2026, os servidores DNS observados foram elle.ns.cloudflare.com e clark.ns.cloudflare.com. A consulta pública à raiz do domínio não devolveu A, AAAA, CNAME, MX, TXT ou CAA. Nenhum registo foi alterado nesta preparação.

O acesso administrativo à nova conta/repositório GitHub foi confirmado. A integração permite editar código e workflows, mas não tem operações para alterar a visibilidade, ativar Pages ou gerir a zona Cloudflare. O acesso da linha de comandos pertence a outra conta e não abre este repositório privado.

As ações oficiais foram fixadas em SHAs completos de releases verificadas. Os checkouts não persistem credenciais. O teste Resend só corre em main. O job de publicação tem apenas as permissões Pages/OIDC necessárias. Pull requests públicos não recebem a chave Resend.

O workflow Pages verifica padrões de credenciais no histórico Git completo sem imprimir os valores. A auditoria é heurística; não garante ausência de todos os tipos de segredo. Existem testes que verificam deteção de uma credencial removida do ficheiro atual mas ainda presente no histórico.

## Código público

Código público é compatível com um site seguro quando os segredos e os controlos ficam no servidor. Tornar o repositório público expõe também a documentação e o histórico.

Guardar chaves em GitHub Actions Secrets ou no gestor de segredos do backend. Não colocar valores no frontend, em ficheiros .env versionados, documentação ou logs. Um colaborador que pode alterar workflows também pode afetar o uso dos segredos: restringir colaboradores e ativar MFA nas contas de gestão.

Rever a proteção de segredos e push protection disponibilizadas pelo GitHub e manter as versões fixadas das ações atualizadas. Nenhum plano pago foi contratado.

## Ordem de configuração segura

1. Rever o resultado da auditoria; depois tornar o repositório público em Settings → General → Danger Zone → Change repository visibility.
2. Em Settings → Pages do repositório, selecionar GitHub Actions como Source.
3. Na conta GitHub, verificar a propriedade do domínio em Settings → Pages usando o TXT exato fornecido pelo GitHub. O TXT é público e pode ser partilhado; não é uma chave de API.
4. Guardar timesaverautomate.com como Custom domain no repositório antes de apontar o DNS.
5. Configurar os registos abaixo, preservando registos existentes com outras finalidades.
6. Confirmar o certificado GitHub Pages e ativar Enforce HTTPS.
7. Só depois de confirmar o certificado de origem, configurar o proxy Cloudflare, Full (strict), encaminhamento HTTPS e cabeçalhos.

O preflight mantém a publicação comercial bloqueada enquanto faltarem os dados legais. Uma revisão técnica não substitui a aprovação factual da informação.

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

## Email e formulário

O teste Resend para timesaverautomate@gmail.com foi aceite e a receção foi confirmada pelo titular. O remetente resend.dev serviu apenas para esse teste.

Adicionar e verificar o domínio/subdomínio no painel Resend; aplicar SPF/DKIM exatos desse painel e avaliar DMARC/alinhamento. Não inventar chaves/seletores DKIM nem criar dois SPF no mesmo nome. A chave existente de envio não concede automaticamente gestão de domínios Resend ou DNS Cloudflare.

O código suporta backend separado em modo API_ONLY, CORS de origem exata, preflight limitado e endpoint HTTPS explícito no cliente. GitHub Pages não executa esse backend. O formulário fica desativado até existir um backend adequado, segredo no servidor, remetente verificado, dados legais completos e teste real do fluxo. A chave não será incluída nos ficheiros públicos.

## Verificações pendentes

Confirmar publicação, DNS, propriedade do domínio, certificados, redirecionamentos, cabeçalhos efetivos, cookies e utilização por teclado/telemóvel. Verificar no servidor entradas inválidas, limites, duplicados, falhas do serviço de email e receção real.

As contas operacionais precisam de MFA, permissões mínimas e manutenção. Não se declara segurança absoluta ou certificação.

Fontes:

- https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- https://resend.com/docs/dashboard/domains/introduction
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
