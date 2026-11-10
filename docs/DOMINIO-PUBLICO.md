# Domínio público e proteção da apresentação

**Concluído e verificado em 10 de novembro de 2026:** https://timesaverautomate.com/ responde 200 por HTTPS. HTTP e www respondem 308 para o endereço principal. O workflow [42853443010](https://github.com/timesaverautomate/time-saver/actions/runs/42853443010) instalou o Worker, associou os dois hosts e verificou domínio, certificados e cabeçalhos. HSTS de um ano está ativo, sem includeSubDomains/preload. A origem GitHub continua independente.

O titular pediu ligar timesaverautomate.com, reforçar a segurança e não fornecer dados legais. A versão pública continua informativa e em pré-lançamento, sem formulário, anexos, contas, pedidos comerciais, pagamentos ou analítica. Não são inventados dados de identificação nem se declara conformidade legal garantida.

## Solução escolhida

Os ficheiros continuam alojados em GitHub Pages, na origem independente https://timesaverautomate.github.io/time-saver/. O Worker **time-saver-edge**, na Cloudflare, serve apenas timesaverautomate.com e www.timesaverautomate.com e consulta essa origem por HTTPS.

Os Custom Domains do Worker criam os registos DNS e certificados necessários através da Cloudflare. Esta funcionalidade não exige uma subscrição separada do Advanced Certificate Manager. Não são alterados planos ou definições de faturação por este processo.

**Não associar o domínio no campo Custom domain do GitHub Pages nesta arquitetura.** A origem GitHub deve continuar independente para evitar um ciclo de redirecionamentos. A proposta anterior de A/CNAME diretamente para Pages foi substituída por esta configuração.

Não é necessário D1, uma chave Resend ou dados legais para executar o código desta camada informativa. Isso não significa que todas as obrigações de identificação deixem de ser aplicáveis; o site não é apresentado como pronto para recolher pedidos comerciais.

## Controlos implementados

- Só GET/HEAD nos dois hosts autorizados e numa lista fechada de recursos. As rotas de API, login e administração não são disponibilizadas.
- Origem HTTPS e prefixo do projeto fixos; não há um proxy aberto nem destino escolhido pelo visitante.
- Os cabeçalhos, cookies, autorização e parâmetros fornecidos no pedido não são copiados para o pedido de aplicação à origem. As infraestruturas podem tratar os seus próprios metadados técnicos.
- HTTP e www encaminhados para o endereço HTTPS principal. Parâmetros desnecessários removidos antes de consultar a origem.
- CSP com script/style/font/imagens locais, connect-src none, form-action none, frame-ancestors none e object-src none.
- X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP e CORP. Cookies da origem não são reencaminhados pelo código.
- Rejeição de pedidos cujo metadado TLS do edge indique TLS 1.0/1.1. É um controlo da aplicação; não se declara que a definição global de TLS da zona foi alterada.
- HSTS de um ano, sem includeSubDomains ou preload, apenas depois de verificar HTTPS e os certificados dos dois hosts.
- Se o HTML da origem passar a conter campos ou formulários, o Worker recusa servi-lo. A recolha comercial não pode ser ativada inadvertidamente nesta camada.
- Observabilidade do Worker desativada e URLs workers.dev/previews desativados. Nenhuma chave de gestão é colocada no Worker ou nos ficheiros públicos.
- Sem rotinas que leiam, criem ou cobrem subscrições; sem D1 ou chamadas ao serviço de email neste workflow.

## Execução e permissões

O workflow **Ligar domínio e proteger site público** só corre em main no repositório estável 1452563434. Executa testes e a pesquisa de padrões de segredos no histórico antes de receber a credencial Cloudflare. As ações estão fixadas em SHAs completos e as credenciais de checkout não persistem.

Usa CLOUDFLARE_SITE_API_TOKEN, se existir, ou a credencial CLOUDFLARE_API_TOKEN já guardada em GitHub Actions Secrets. A API oficial de ligação de Custom Domains aceita Workers Scripts: Write. É necessário que o âmbito da credencial inclua a conta e a zona pretendidas. Se existir mais de uma conta visível, definir a variável CLOUDFLARE_ACCOUNT_ID para selecionar a conta autorizada.

O processo recusa substituir um Worker sem o identificador deste projeto, um domínio ligado a outro serviço ou registos DNS públicos existentes de um serviço alheio. Não utiliza opções para forçar a substituição desses registos.

Se a credencial ou a emissão de certificado impedir a conclusão, o resultado indica apenas um código, a operação e o estado HTTP. Não divulga respostas internas ou o valor da credencial. Domínios já associados com êxito são identificados como resultado parcial; certificado ou propagação pendente nunca são marcados como verificados.

## Operação

Os commits do site continuam a publicar os ficheiros no GitHub. A camada Cloudflare consulta-os com cache curto (60 segundos). Alterações a src/site-proxy.mjs ou ao instalador voltam a publicar o Worker. O workflow também pode ser repetido em Actions.

Ao mudar o alojamento, manter um serviço HTTPS com certificado válido antes de retirar este Worker ou alterar os registos: os navegadores podem conservar HSTS durante o prazo indicado.

Manter MFA nas contas GitHub/Cloudflare, limitar quem pode alterar workflows e rever os acessos. Rever periodicamente o Node, ações fixadas, condições do alojamento e limites da conta. Não é possível afirmar segurança absoluta.

O formulário e o serviço de orçamentos não fazem parte desta apresentação ativa. As minutas completas permanecem no repositório, sem as publicar no site. Não foi ativada qualquer recolha adicional para contornar a decisão do titular.

Fontes oficiais consultadas:

- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/
- https://developers.cloudflare.com/workers/runtime-apis/request/
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
