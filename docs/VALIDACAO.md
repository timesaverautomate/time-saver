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

## A confirmar depois de publicar

- Instalação da API e publicação Pages desta versão.
- Submissão pelo formulário público e entrega efetiva do respetivo email, incluindo dados de triagem.
- Repetição controlada da tentativa com a mesma referência e apenas uma mensagem na caixa.
- Verificações HTTP reais de dados inválidos, origem, honeypot e limite de tamanho.
- Chromium com largura de telemóvel e computador, teclado, orientações condicionais, erros com campos preservados e estados de envio.

## Limites e pendências operacionais

A suite substitui o fornecedor na simulação de falha; não provoca uma indisponibilidade deliberada do Resend de produção. Não foi feita auditoria externa, teste de intrusão, certificação WCAG ou teste completo com leitores de ecrã. Os contadores Cloudflare são aproximados por localização. Novas páginas/tentativas não são deduplicadas permanentemente.

O titular aceitou a retenção do Resend durante 30 dias; a caixa Gmail conserva as mensagens. A revisão dos contratos, subcontratantes, garantias de transferências e a execução da rotina de eliminação permanecem operacionais. A identificação jurídica foi omitida a pedido do titular; não se declara conformidade integral nem se ativa indexação. Não se fizeram compras.
