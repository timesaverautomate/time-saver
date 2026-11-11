# Agenda integrada na Time Saver

O botão «Marcar conversa gratuita» abre uma janela com a identidade azul-escura e verde-água do site. A marcação continua no evento público já configurado: https://calendly.com/timesaverautomate/30min. O evento tem 30 minutos; não se altera a disponibilidade nem se criam reuniões automaticamente.

- `scripts/site-settings.mjs`: apresentação PT/EN, explicação dos passos e ligação externa alternativa.
- `public/app.js`: carrega o calendário apenas após clique, valida o endereço, aplica as cores, fecha/descarrega o iframe e devolve o foco. Não copia os campos do orçamento para a agenda.
- `public/styles.css`: janela adaptada a computador e telemóvel.
- `scripts/build-github-pages.mjs` e `src/site-proxy.mjs`: permitem apenas `https://calendly.com` em `frame-src`; mantêm as restrições de scripts, ligações e proteção contra enquadramento do site.
- Política de Privacidade e informação sobre cookies PT/EN: descrevem o carregamento voluntário do fornecedor. As escolhas de cookies do Calendly não são ocultadas.

A ligação original funciona sem o diálogo e permite abrir o Calendly noutro separador. O código do site não controla o conteúdo interno, traduções, cookies ou disponibilidade do Calendly. O fornecedor pode apresentar avisos quando o navegador restringe armazenamento de terceiros.

Validação antes da publicação: 173 testes automáticos aprovados; janela PT/EN verificada a 320, 375, 390 e 1440 px; ausência de carregamento do Calendly antes do clique; funcionamento do teclado, fecho e restituição do foco; calendário real carregado no navegador sem criar reuniões. Formulário e processamento dos pedidos preservados.
