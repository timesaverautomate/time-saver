# Entrega da atualização — 11 de novembro de 2026

O sítio mantém o desenho atual, o destaque verde-água e “Pedir orçamento” como ação principal. Não foram acrescentados fotografias, nomes ou outros dados pessoais da equipa, clientes identificados, testemunhos ou métricas inventadas. O preço apresentado é **“Projetos desde 199 € + IVA. Orçamento gratuito em 24–48 h.”**, sem tabela de preços.

## Alterações por prioridade e ficheiro

Os links seguintes abrem o **código completo** de cada ficheiro. Não são apenas excertos ou diferenças. Também pode [descarregar o repositório completo](https://github.com/timesaverautomate/time-saver/archive/refs/heads/main.zip); essa ligação acompanha a versão atual de `main`.

| Prioridade | Ficheiro completo | Alteração |
| --- | --- | --- |
| 1 — Confiança | [public/index.html](../public/index.html) | “Quem somos”, três trabalhos reais com problema/solução/resultado qualitativo, confidencialidade e bloco sobre proteção de dados. Inclui também o conteúdo PT das prioridades 2 e 3. |
| 1 — Apresentação | [public/styles.css](../public/styles.css) | Estilos localizados, contraste dos textos secundários, adaptação a telemóvel e redução dos espaços excessivos. |
| 1 — Informação fiel | [scripts/contact-html.mjs](../scripts/contact-html.mjs) | Páginas informativas publicadas: distingue trabalhos reais de exemplos ilustrativos e descreve o registo existente em Google Sheets, além do email. |
| 2 — Formulário | [public/app.js](../public/app.js) | Validação e mensagens PT/EN, recuperação sem perder os campos e confirmação clara, mantendo o percurso de envio existente. |
| 2 — Contactos | [config/site.json](../config/site.json) | Domínio, indexação, ligação Calendly e marcador do WhatsApp. Não contém segredos. |
| 2 — Ligações | [scripts/site-settings.mjs](../scripts/site-settings.mjs) | Valida as ligações públicas e gera os contactos nas duas línguas; evita ligações partidas quando falta configuração. |
| 2 — Limite autorizado | [src/validation.mjs](../src/validation.mjs) | Mínimo da descrição reduzido de 30 para 10 caracteres também no servidor, com autorização, para coincidir com o formulário. |
| 4 — Inglês | [public/en.html](../public/en.html) | Página inglesa completa em `/en/`, incluindo conteúdo, contactos, preços e formulário. |
| 4 — Privacidade EN | [public/en-privacy.html](../public/en-privacy.html) | Política de Privacidade em inglês. |
| 4 — Informação EN | [public/en-legal.html](../public/en-legal.html) | Informação sobre o sítio em inglês. |
| 4 — Cookies EN | [public/en-cookies.html](../public/en-cookies.html) | Informação sobre cookies em inglês. |
| 5 — Construção e SEO | [scripts/build-github-pages.mjs](../scripts/build-github-pages.mjs) | Rotas bilingues, títulos/descrições, Open Graph, favicon, canonical, hreflang e sitemap. |
| 5 — Alojamento | [src/site-proxy.mjs](../src/site-proxy.mjs) | Serve as rotas inglesas e o sitemap; permite indexação no domínio público, preservando os cabeçalhos de segurança. |
| 5 — Configuração | [wrangler.jsonc](../wrangler.jsonc) | Configuração de indexação do domínio. |
| 5 — Publicação | [scripts/deploy-site-domain.mjs](../scripts/deploy-site-domain.mjs) | Publicação das opções do sítio e verificações do domínio. |
| 5 — Verificação | [scripts/run-site-domain.mjs](../scripts/run-site-domain.mjs) | Integra a configuração pública e as verificações de segurança. |
| 5 — Workflow | [.github/workflows/site-domain.yml](../.github/workflows/site-domain.yml) | Executa a publicação e as verificações necessárias após alterações relevantes. |
| 5 — Diagnóstico protegido | [src/contact.mjs](../src/contact.mjs) | Restringe o diagnóstico técnico do CRM a chamadas internas assinadas e limitadas, conforme autorizado. Não substitui Resend ou Sheets. |
| 5 — Assinatura interna | [src/security.mjs](../src/security.mjs) | Assinatura HMAC temporária para o diagnóstico; nenhuma credencial é exposta ao navegador. |
| 5 — Cliente de diagnóstico | [scripts/check-quote-health.mjs](../scripts/check-quote-health.mjs) | Efetua a consulta interna assinada. |
| Validação | [tests/backend.test.mjs](../tests/backend.test.mjs) | Verificações do processamento e dos limites. |
| Validação | [tests/content.test.mjs](../tests/content.test.mjs) | Conteúdo, formulário e ausência de segredos no frontend. |
| Validação | [tests/site-settings.test.mjs](../tests/site-settings.test.mjs) | Ligações de contactos e configuração em falta. |
| Validação | [tests/seo-pages.test.mjs](../tests/seo-pages.test.mjs) | Exportação bilingue, rotas e metadados. |
| Validação | [tests/diagnostic-auth.test.mjs](../tests/diagnostic-auth.test.mjs) | Recusa de diagnóstico não autorizado e aplicação dos limites antes de aceder à Google. |
| Entrega | [docs/ATUALIZACAO-2026-11-11.md](ATUALIZACAO-2026-11-11.md) | Este relatório e as instruções de verificação. |

A prioridade 3 está nos ficheiros HTML e CSS acima: destaque financeiro para pequenas empresas, Excel/VBA/Power Automate, “Antes → Depois”, secção “Para quem” e FAQ coerente com preço fechado antes do início, duas rondas de ajustes, 30 dias de correção de erros e suporte mensal opcional.

## Formulário e serviços preservados

O envio parte de [public/app.js](../public/app.js), por `POST /api/quote`, e é processado em [src/contact.mjs](../src/contact.mjs). O percurso existente pelo Resend e pelo Google Sheets privado foi preservado; [src/quote-sheets.mjs](../src/quote-sheets.mjs) continua a tratar o registo interno. O registo pode existir antes de o serviço de email aceitar o envio.

Nome, email e descrição são obrigatórios. A descrição aceita 10–4 000 caracteres. O honeypot já existente foi mantido. A opção **“Li a Política de Privacidade” é uma confirmação de leitura opcional**, não consentimento genérico obrigatório nem autorização de marketing. O tratamento do pedido mantém os fundamentos descritos na política. A caixa não acrescenta um campo ao pedido enviado ao servidor.

O Calendly fornecido é `https://calendly.com/timesaverautomate/30min`. Por corresponder a 30 minutos, o botão usa **“Marcar conversa gratuita”**, sem prometer uma duração de 20 minutos. O email direto é `timesaverautomate@gmail.com`.

## Verificações já executadas nesta atualização

- `npm run check`: **114 testes aprovados**, incluindo oito novos testes do diagnóstico protegido.
- Playwright em PT e EN a **320, 375, 768, 981 e 1440 px**, sem deslocação horizontal. Foram usados o formulário e o código reais com os serviços externos simulados.
- Validação do email, descrição de 10 caracteres, caixa de leitura opcional, estados de erro/sucesso e mensagens nas duas línguas.
- Nos testes locais foram usados fornecedores simulados. Após publicação, foi também enviado um pedido real identificado como teste interno através do formulário EN, com descrição de dez caracteres; chegou à INBOX da Time Saver.
- O diagnóstico interno assinado foi aprovado no GitHub Actions, sem criar um pedido. Uma chamada pública sem assinatura devolveu HTTP 403.

Estas verificações não são uma certificação de acessibilidade, segurança absoluta ou conformidade jurídica integral. As proteções e os fornecedores exigem manutenção. A identificação legal não foi inventada ou publicada como dado pessoal da equipa.

## Como testar o envio publicado, em PT e EN

1. Abra `https://timesaverautomate.com/#orcamento` e confirme o preço e o idioma PT. Depois repita os passos em `https://timesaverautomate.com/en/#orcamento`.
2. Tente enviar sem preencher os campos obrigatórios. Deve ver erros claros e o pedido não deve ser enviado.
3. Preencha um nome de teste e um email inválido, como `teste@`. Confirme a mensagem junto ao email. Substitua-o depois por um email seu válido.
4. Experimente uma descrição de nove caracteres, como `123456789`: deve ser rejeitada. Para testar o mínimo, utilize `Teste 1234`, que tem dez caracteres.
5. Deixe a caixa de leitura da política por assinalar. O pedido deve poder seguir; também pode repetir outro teste com a caixa assinalada.
6. Envie **uma vez**. A mensagem PT deve começar por “Recebemos o seu pedido. Respondemos em 24–48h úteis.” e apresentar uma referência `TS-…`. Em EN, deve surgir a mensagem inglesa equivalente. Guarde a referência.
7. Na caixa `timesaverautomate@gmail.com`, procure o assunto **“Time Saver — Novo pedido de orçamento”** e a referência. Confirme a mensagem na INBOX; verifique também o spam se necessário. A mensagem do sítio, por si só, não confirma entrega na caixa de entrada.
8. Confirme, com acesso autorizado, o registo correspondente na folha privada de pedidos. Não publique o conteúdo nem credenciais nos comentários do GitHub.
9. Para verificar duplo clique, faça-o na mesma tentativa: o botão deve ficar bloqueado durante o envio e deve chegar uma única mensagem com essa referência. Recarregar a página ou criar outro pedido inicia uma nova tentativa e pode produzir outra referência.
10. Repita com a versão inglesa usando outro teste identificado como tal. Abra também os links legais, o seletor PT | EN, o email direto e o Calendly; confirme a disponibilidade do evento na agenda.

## O que falta preencher

**`[NUMERO_WHATSAPP]`**, em [config/site.json](../config/site.json): substituir pelo número internacional sem `+`, espaços ou separadores. Enquanto faltar, o botão é omitido na versão construída para evitar uma ligação inválida. Após preencher e guardar no GitHub, aguardar a publicação e testar a mensagem pré-preenchida nas duas línguas.

Não faltam fotografias nem nomes da equipa: foram retirados do âmbito a pedido do titular.

## Estado final verificado

- Implementação publicada: [`b7cbbba0c14997e94207c19c0eae22c7dfcab88a`](https://github.com/timesaverautomate/time-saver/commit/b7cbbba0c14997e94207c19c0eae22c7dfcab88a).
- [Publicação GitHub Pages](https://github.com/timesaverautomate/time-saver/actions/runs/42992476526): aprovada.
- [Domínio, segurança e diagnóstico interno](https://github.com/timesaverautomate/time-saver/actions/runs/42992476438): aprovados. TLS 1.0/1.1 recusados no handshake; TLS 1.2/1.3 confirmados.
- Oito páginas PT/EN devolveram HTTP 200 no domínio público. Canonical, hreflang, sitemap, robots e cabeçalhos de segurança foram verificados. API e erros continuam sem indexação.
- Navegação real no domínio a 375 e 1440 px, nas duas línguas: sem erros JavaScript, deslocação horizontal ou cookies observados. A revisão local abrangeu também 320, 768 e 981 px.
- Pedido real de teste: **TS-796C04A3305ABC969DCB**, enviado pelo formulário EN com uma descrição de dez caracteres. Confirmado na **INBOX em 11/11/2026 às 09:08:56 UTC**. Duplo clique produziu um POST; repetição do mesmo pedido devolveu a mesma referência. A pesquisa dessa referência encontrou um único email.
- SPF, DKIM e DMARC foram aprovados pelo Gmail nessa mensagem. A política DMARC observada é de monitorização (`p=none`); não se afirma que imponha rejeição de mensagens falsificadas.
- O teste foi identificado como **TESTE INTERNO — atualização PT/EN 11-11-2026**. O processamento existente inclui a folha privada do CRM; não foram apagados registos. O acesso à folha foi verificado pelo workflow, mas a linha deste teste não foi consultada separadamente nesta ronda.

O único marcador de configuração acrescentado que falta preencher é o número de WhatsApp. A identificação legal continua fora da publicação por opção do titular; este trabalho não atesta que essa opção satisfaça as obrigações legais aplicáveis.
