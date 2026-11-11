# Correções e verificação de segurança — 11/11/2026

> Registo histórico desta verificação. A [auditoria posterior do mesmo dia](AUDITORIA-SEGURANCA-2026-11-11.md) documenta a correção adicional da escrita após ordenação, o novo ciclo de vida dos marcadores associados à linha e a verificação do webhook auxiliar. As descrições abaixo referem-se à versão então testada.

As duas pendências identificadas na reposição visual foram tratadas e verificadas em produção. O HTML PT/EN, CSS, JavaScript do navegador e aspeto do sítio mantiveram os mesmos hashes.

Código: [2cf9b41](https://github.com/timesaverautomate/time-saver/commit/2cf9b41d7a7b23f56ba9292fdc5b0f4a9c4e3fa5). [Execução de produção](https://github.com/timesaverautomate/time-saver/actions/runs/43001015996).

## Pedidos simultâneos no CRM

A linha e um marcador técnico único são agora criados no mesmo `spreadsheets.batchUpdate` da Google. Quando duas chamadas tentam criar a mesma referência, a unicidade do marcador faz falhar a segunda transação inteira, sem acrescentar outra linha. A repetição recupera o registo existente. O conteúdo da mesma referência também é comparado: alterações devolvem HTTP 409 antes de enviar email; falhas transitórias conservam a tentativa.

O marcador tem uma chave de dois caracteres (`tq`), um ID determinístico e nenhum valor ou conteúdo do formulário. Mantém-se na folha privada existente. Não foram acrescentados fornecedores, serviços pagos ou bases de dados de pedidos ao sítio.

Uma prova prévia na Google usou apenas uma folha temporária oculta: duas transações simultâneas produziram uma linha, as fórmulas permaneceram texto literal, a formatação foi preservada e a folha temporária foi removida. Só depois se publicou o novo backend.

O teste final pelo formulário público fez dois POSTs simultâneos e uma repetição com o mesmo corpo e chave. Os três devolveram a mesma referência **TS-BE0228AC027D2B42AB81**. Foi confirmada **uma linha no CRM**, com estado `Novo`, e **um email na INBOX** de `timesaverautomate@gmail.com`, em 11/11/2026 às 10:09:42, hora de Lisboa. O registo está identificado como teste interno e foi conservado; não foram apagados pedidos comerciais.

## Rate limit em produção

A publicação passou a reler na Cloudflare os três contadores instalados: cinco tentativas por minuto por origem, 30 emissões de ticket por minuto por origem e 30 envios válidos por minuto por localização. Se a configuração divergir, a verificação falha.

A prova real executou apenas POSTs `{}` deliberadamente inválidos, sem criar pedidos ou enviar emails. Usou um socket HTTPS IPv4 e confirmou a mesma origem e localização através de metadados autenticados por uma assinatura temporária. IPs, tokens e fingerprints não foram escritos nos logs.

Resultado observado: `422, 422, 422, 422, 422, 422, 429, 429, 422`. O bloqueio persistiu, apresentou `Retry-After: 60` e a recuperação foi confirmada após 65 segundos. Origem, localização e socket mantiveram-se estáveis.

Os contadores nativos Cloudflare são aproximados: nesta execução aceitaram seis tentativas antes de bloquear. Não se afirma um corte exato na sexta chamada nem uma quota mundial estrita. A proteção funciona em conjunto com validação no servidor, limite de corpo, deadline, origem, ticket assinado, honeypot e idempotência do email.

O código de diagnóstico não muda a chave nem a decisão do limitador real. As informações técnicas de prova só são devolvidas a chamadas com assinatura interna válida, numa janela curta, e são diferentes da capacidade de diagnóstico do CRM.

## Verificações adicionais

- **162 testes Node aprovados**, incluindo concorrência, timeouts, resposta perdida, transação atrasada, colisões de IDs, payload alterado, fórmulas literais e assinaturas.
- **31 testes Python aprovados** localmente. Corrigido também um teste que falhava apenas devido à capitalização do texto de uma simulação, sem alterar mensagens ou autorizações de envio.
- QA PT/EN a 375/1440 px: estados 503/409, recuperação com a mesma chave, bloqueio de duplo envio, conteúdo malicioso apresentado como texto, navegação do hero e ausência de erros JavaScript.
- HTTPS, HSTS, CSP/Trusted Types, proteção de enquadramento, `nosniff`, ausência de cookies observados e diagnóstico público bloqueado foram mantidos.
- A auditoria do histórico por padrões conhecidos passou no GitHub Actions; não é uma prova matemática de ausência de todos os segredos.
- Corrigida também uma chaveta adicional introduzida em paralelo em `wrangler.jsonc`, que tornava inválida a configuração da ferramenta. A estrutura foi validada e a preferência de observabilidade dessa edição foi preservada. O processo de publicação do domínio continua a desativar observabilidade no upload do Worker público; esta correção de sintaxe não alterou a configuração que foi verificada em produção.

O código de um Worker Resend separado recebeu leitura limitada a 64 KiB, deadline de oito segundos, validação Svix estrita, erros seguros e logs apenas com categorias fixas. Foram preservadas as alterações de diagnóstico feitas em paralelo. A compatibilidade com o SDK Svix foi testada. Esse Worker continua em simulação, sem envios ou escrita no CRM; esta entrega não o publicou nem verificou um endereço de produção separado.

## Operação e limites

Continuam a ser necessários atualizações, controlo de acessos, autenticação multifator nas contas de gestão e acompanhamento dos alertas. A retenção deve abranger Gmail, Resend e a folha privada.

O leitor atual da folha tem um limite próximo de 10 000 linhas. Os marcadores usam dois caracteres por entrada face à quota Google de 30 000 caracteres de metadados por folha; outros metadados também consomem essa quota. Os marcadores são permanentes: arquivar ou apagar linhas não elimina os respetivos marcadores. Antes de aproximar estes limites, deve planear-se uma migração ou manutenção que preserve a idempotência. O sistema falha com uma mensagem segura quando não consegue confirmar o registo; não anuncia sucesso nessas condições.

Estas verificações confirmam os comportamentos executados. Não constituem garantia de segurança absoluta, disponibilidade ilimitada ou conformidade jurídica integral.
