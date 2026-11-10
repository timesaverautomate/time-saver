# Validação da versão atual

Data: 10/11/2026. Arquitetura ativa: GitHub Pages + Worker Cloudflare `time-saver-edge` + Resend + Gmail, sem base de dados de pedidos. Os resultados de versões anteriores com D1 estão no histórico Git e não descrevem o fluxo atual.

## Executado antes da publicação

- `npm run check`: **58 testes aprovados**. Incluem formato e limites no servidor, listas de triagem, origem, tickets, honeypot, corpo excessivo, rate limit, fornecedor com falha/redirecionamento/sem ID e resposta pública sem detalhes internos.
- Idempotência: mesma tentativa produz referência, data, corpo e chave de fornecedor iguais. A supressão efetiva de duplicados no Resend depende da verificação real indicada abaixo.
- Workerd/Miniflare: os quatro módulos, contadores nativos e fluxo completo até um fornecedor de teste executaram com sucesso. Sem base de dados.
- Wrangler 4.160.0 `deploy --dry-run`: compilação e três bindings de rate limit aceites; não instala recursos nem valida credenciais.
- Exportação de contacto: sete categorias, contexto opcional, páginas sem marcadores legais, descrição real da retenção; formulário desativado na origem GitHub e ativado apenas pelo domínio com API configurada.
- Pesquisa heurística de padrões de segredos: 30 commits e 143 blobs antes desta publicação, sem ocorrências dos padrões procurados. Não equivale a garantia de ausência de todo e qualquer segredo.
- Remetente real: teste técnico pelo workflow 42857150024, aceite pelo Resend, recebido na caixa INBOX de `timesaverautomate@gmail.com`. Cabeçalhos Gmail confirmam SPF, DKIM e DMARC pass. DMARC observado em monitorização (`p=none`).

## Executado no domínio público

- Worker publicado e verificado pelo workflow [42860411797](https://github.com/timesaverautomate/time-saver/actions/runs/42860411797); GitHub Pages publicado pelo workflow [42860411662](https://github.com/timesaverautomate/time-saver/actions/runs/42860411662), commit `70423be1bd738d975f4bc9f9f7449d315735f47a`.
- Formulário disponível em https://timesaverautomate.com/#orcamento. Pedido sintético submetido pela interface às 17:02 UTC, referência `TS-EC711BFE90FB4FAA8917`, recebido na **INBOX** de `timesaverautomate@gmail.com`. A mensagem contém categoria, objetivo, frequência, ponto de partida, ferramentas, detalhes e descrição. SPF, DKIM e DMARC pass; Reply-To correto.
- Repetição da mesma tentativa: resposta 200 com a mesma referência. Duas pesquisas posteriores na caixa encontraram **uma única mensagem** com essa referência. Não há deduplicação permanente entre páginas novas.
- Pedidos HTTP reais: origem externa 403, email inválido 422, honeypot 400, corpo superior ao limite 413. Todas estas respostas usam `no-store`.
- Limitação real: sequência apenas de pedidos inválidos, sem envio de email, terminou em 429. A primeira sequência muito rápida de seis pedidos ainda devolveu 422; numa sequência espaçada houve 429 após sete rejeições, coerente com os contadores aproximados/assíncronos do fornecedor. Não se afirma um corte exato na sexta tentativa.
- Início e páginas informativas: 200, HSTS de um ano, DENY e ausência de Set-Cookie nas respostas observadas. Login e admin: 404. A origem GitHub mantém modo `disabled`; o domínio protegido ativa o modo `backend`.
- Chromium com os recursos públicos a 375 e 1440 px: formulário, orientações condicionais, rádio por teclado e salto inicial, sem deslocação horizontal, erros JavaScript, recursos falhados ou pedidos a terceiros. O cliente HTTP validou TLS e forneceu os recursos ao Chromium por interceção, devido à CA de inspeção do ambiente; não se desativou a validação TLS.
- Interface com API de teste a 320/375/768/1440 px: campos inválidos, dados preservados após falha, novo envio, limpeza após aceitação, duplo clique bloqueado e botão de novo pedido aprovados.
- Auditoria do histórico em Actions aprovada após identificar explicitamente dois valores fictícios novos da suite; a deteção de credenciais desconhecidas e de credenciais removidas do código atual mantém-se testada.

## Limites e pendências operacionais

A suite substitui o fornecedor na simulação de falha; não provoca uma indisponibilidade deliberada do Resend de produção. Não foi feita auditoria externa, teste de intrusão, certificação WCAG ou teste completo com leitores de ecrã. Os contadores Cloudflare são aproximados por localização. Novas páginas/tentativas não são deduplicadas permanentemente.

O titular aceitou a retenção do Resend durante 30 dias; a caixa Gmail conserva as mensagens. A revisão dos contratos, subcontratantes, garantias de transferências e a execução da rotina de eliminação permanecem operacionais. A identificação jurídica foi omitida a pedido do titular; não se declara conformidade integral nem se ativa indexação. Não se fizeram compras.
