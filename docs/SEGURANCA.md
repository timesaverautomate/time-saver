# Revisão de segurança — 10/11/2026

Âmbito: código ativo, exportação GitHub Pages, Worker `time-saver-edge`, formulário, processamento de email, cabeçalhos e workflows de publicação. A revisão não equivale a certificação, auditoria externa ou garantia de ausência de vulnerabilidades. O formulário continua sem base de dados de pedidos e sem contas públicas.

## Resultado da revisão do código

Não foi identificado um caminho ativo para executar JavaScript, HTML, SQL, VBA ou comandos introduzidos nos campos. Os valores são validados e enviados como **texto simples**. Mensagens da API são apresentadas com `textContent` e elementos criados de forma segura; não se usa `innerHTML` ou `eval` para apresentar conteúdo. Não há uploads, SQL, execução de macros, instalação de aplicações ou interpretação de código enviado pelo visitante. É possível escrever texto parecido com código, mas esse texto não é executado. Uma lista de palavras proibidas não substituiria estas proteções.

Destinatário, remetente, assunto e URL do fornecedor são fixos no servidor. O email validado do visitante só é usado no Reply-To. Comprimentos, tipos, caracteres de controlo e opções são verificados no servidor, incluindo quando alguém contorna o JavaScript. Campos adicionais como destinatários são rejeitados. Segredos não são enviados ao navegador.

## Correções aplicadas

- O limite por IP é aplicado antes de validar formato ou chave e termina imediatamente com 429 quando a origem já está limitada.
- Pedidos limitados, inválidos, com honeypot ou ticket inválido não consomem a quota partilhada de envios. Isto corrige uma forma de um IP já bloqueado prejudicar outros visitantes.
- O corpo tem limite de **16 KiB** e **8 segundos totais** de leitura. Fragmentos sucessivos não renovam o prazo. Timeout devolve 408 e cancela a leitura sem aguardar indefinidamente pelo cliente.
- CSP reforçada: sem scripts/estilos inline, sem eval, sem enquadramento, sem objetos ou workers no navegador. Trusted Types bloqueia adicionalmente os pontos de injeção DOM nos navegadores que o suportam.
- Os campos ficam temporariamente bloqueados durante o envio, para não apagar alterações que tenham sido feitas enquanto uma versão anterior estava a ser enviada.
- Uma sessão expirada pode ser renovada sem apagar os campos; requer novo clique do visitante e não repete automaticamente o envio.
- A publicação verifica os cabeçalhos principais, ausência de cookies/CORS e `no-store` na API. Os testes de email passaram a ser manuais e também dependem de testes e auditoria antes de aceder às credenciais.
- O scanner heurístico passou a reconhecer tokens Resend com hífen, incluindo valores removidos do ficheiro atual mas presentes no histórico. Não imprime os valores encontrados.
- Os jobs Pages têm limites de duração. Actions permanecem fixadas em SHAs. Foram corrigidos quatro contrastes de texto pequeno no formulário.

## Limites contra abuso

Contadores nativos Cloudflare: **5 tentativas por minuto por origem**, **30 emissões de ticket por minuto por origem** e **30 envios válidos por minuto por localização de execução**. O IP é transformado num identificador HMAC diário; a aplicação não grava o IP em claro nem o conteúdo do pedido. Os contadores são aproximados e distribuídos por localização: não se afirma um corte exato na sexta chamada ou uma quota mundial estrita. CORS/origem/tickets não são apresentados como autenticação de pessoas ou proteção suficiente, por si só, contra bots.

Honeypot, origem HTTPS exata, ticket assinado com tempo mínimo e idempotência do Resend complementam os limites. O navegador evita duplo clique e conserva a mesma chave na repetição da mesma tentativa. Não existe deduplicação permanente entre páginas novas. Um ataque distribuído ou humano continua possível; acompanhar quotas do fornecedor e falhas, sem registar corpos de pedidos. Não há mudança automática para planos pagos. Um desafio externo não foi acrescentado sem necessidade demonstrada e avaliação de acessibilidade/privacidade.

## Verificações executadas antes da publicação

**67 testes automáticos aprovados**. Incluem validação, injeção em cabeçalhos, campos adicionais, formatos/JSON inválidos, corpo excessivo, tickets adulterados/expirados, isolamento das quotas, falhas do fornecedor, idempotência e timeout absoluto com relógio de teste. O motor workerd executou os módulos e o envio para um fornecedor simulado com sucesso.

Chromium a 375 e 1440 px, com API inteiramente simulada: um erro com `<img onerror>` e `<script>` foi apresentado como texto, sem execução nem elementos injetados. Trusted Types bloqueou atribuição de HTML e handlers inline. Campos bloqueados durante busy e restaurados após falha; renovação preservou dados e não enviou automaticamente. Uma resposta 200 sem aceitação não foi anunciada como sucesso. Não foram enviados emails nesses testes.

A publicação e as verificações HTTP desta revisão serão registadas abaixo após execução. Os testes anteriores de entrega real, SPF/DKIM/DMARC e duplicados estão em [VALIDACAO.md](VALIDACAO.md).

## Operação e limites da verificação

O instalador tenta consultar o TLS mínimo da zona e subir versões 1.0/1.1 para 1.2, preservando uma configuração 1.3 existente. Só declara o valor confirmado após leitura. Se a credencial não permitir consultar ou alterar essa opção, regista essa pendência; o bloqueio HTTP a TLS antigo não é confundido com recusa do handshake.

A configuração e manutenção de MFA/passkeys, acessos à caixa Gmail e contas de gestão, restrição dos tokens e regras de proteção do repositório não podem ser confirmadas apenas pelo código. Confirmar em cada conta e rever periodicamente acessos. Em GitHub Settings → Branches/Rulesets, avaliar proteção de main e impedir force push; em Settings → Code security, confirmar as proteções disponíveis no plano. Não bloquear a manutenção com regras que o titular não consiga cumprir.

A auditoria de padrões não identifica todos os tipos possíveis de segredos; não elimina a necessidade de rodar uma credencial se alguma exposição for confirmada. Não houve testes destrutivos, scans de elevado volume ou alteração de planos. Continuam necessárias atualizações e verificação após mudanças. A retenção Resend/Gmail e as pendências jurídicas mantêm-se descritas em [FORMULARIO-EMAIL.md](FORMULARIO-EMAIL.md).
