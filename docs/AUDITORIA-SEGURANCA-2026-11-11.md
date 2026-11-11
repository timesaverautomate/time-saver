# Auditoria técnica de segurança e funcionamento — 11/11/2026

## Resultado e âmbito

Foi revisto o código do site público, o processamento do formulário, a integração com Sheets/Resend, os webhooks e os workflows de gestão existentes no repositório. A revisão começou em `20224c51` e incorporou as alterações concorrentes do proprietário em `af75fba3`, preservando as regras de estados e a desativação da escrita de teste.

Não foi identificado um caminho ativo para executar código introduzido nos campos, escolher destinatários externos, contornar a assinatura dos webhooks ou obter credenciais pelo frontend. Foram encontradas e corrigidas falhas de consistência e de manutenção descritas abaixo. Esta conclusão limita-se aos caminhos e configurações efetivamente examinados; não é garantia de ausência de vulnerabilidades, falhas futuras ou conformidade jurídica integral.

## Correções

| Componente | Problema | Correção |
| --- | --- | --- |
| `src/quote-sheets.mjs` | Uma ordenação entre leitura e escrita podia fazer a confirmação atingir outra linha; uma alteração manual de estado também podia ser sobrescrita. | Inserção e âncora da linha na mesma transação; confirmação por `DataFilter` ligado à âncora, escrevendo só data e ID Resend. O estado inicial usa uma fórmula controlada e as alterações manuais permanecem. |
| `scripts/verify-quote-atomic-provider.mjs` | Faltava prova real de ordenação e da preservação de campos. | Prova numa folha temporária, incluindo pedidos simultâneos, ordenação, âncora, texto literal, fórmula, campos ignorados e estado manual. A folha é eliminada e o deploy fica bloqueado se a prova falhar. |
| `workers/resend-webhook.js` | Chamadas Google sem timeout; falhas de atualização podiam ser confirmadas como aceites; eventos atrasados podiam degradar estados. | Timeout de 12 s, redirecionamentos recusados, token validado, estados terminais preservados e falhas recuperáveis com 503, sem confirmação falsa. A simulação e as flags de escrita existentes foram preservadas. |
| `scripts/audit-repository-secrets.py` | Não detetava alguns PEM escapados em JSON nem segredos Svix/Resend. | Novos padrões e testes de regressão, sem imprimir os valores. Uma exceção exata identifica um literal sintético de teste; credenciais desconhecidas continuam a bloquear. |
| Workflows CRM e ficheiros `requirements-*.txt` | Actions por tags mutáveis e dependências Python sem versões/hashes. | Actions fixadas por SHA, credenciais de checkout não persistidas, bibliotecas e transitivas com versões/hashes, instalação por wheels e verificações antes de usar segredos. |
| `scripts/resend_webhook.py` | O retorno do SDK Svix 2 era tratado como JSON, embora o SDK passe a confirmar apenas a assinatura. | Verificação da assinatura antes do `json.loads`, com validação do tipo do evento e testes com assinatura real sintética. |
| `package.json` e `wrangler.jsonc` | O comando manual podia escolher uma configuração diferente da publicação validada e reativar registos. | `npm run deploy` passa pelo fluxo autorizado e recusa execução fora desse contexto; a configuração do Worker público deixa observabilidade e logs desativados. |
| Publicação do webhook auxiliar | Era necessário aplicar as correções ao Worker separado e preservar segredos/flags. | Upload aceite com identificação do Worker e herança estrita dos bindings. O código devolvido pela Cloudflare foi reproduzido localmente com Wrangler 4.160.0: SHA-256 e tamanho coincidem exatamente. A verificação pública e o estado de logs são indicados no fecho desta auditoria. |

O HTML, CSS e JavaScript público não foram redesenhados nesta auditoria. O formulário continua com Nome/Empresa, email, seleção múltipla e três passos; não foram acrescentados login, pagamentos, anexos ou armazenamento persistente do formulário no navegador.

## Provas reais

- [Protocolo isolado, aprovado antes da publicação](https://github.com/timesaverautomate/time-saver/actions/runs/43027658835): inserção única, ordenação, âncora, fórmula, texto literal, campos ignorados, estado manual e eliminação da folha temporária confirmados.
- [Publicação do backend e provas finais](https://github.com/timesaverautomate/time-saver/actions/runs/43027955208): domínio/API, permissões de diagnóstico, configuração dos contadores, handshake TLS, rate limit e concorrência aprovados.
- O teste de concorrência enviou dois POSTs simultâneos e uma repetição. A referência `TS-C54DBA0024511D9FC3CC` apareceu numa única linha do CRM e numa única mensagem recebida na INBOX de `timesaverautomate@gmail.com`. A mensagem sintética foi depois arquivada em Testes internos, sem eliminar pedidos comerciais.
- Rate limit observado: `422, 422, 422, 422, 422, 422, 429, 429, 422`; `Retry-After: 60`; recuperação confirmada após 65 s, com a mesma origem/localização/socket. O contador é aproximado e permitiu seis tentativas antes de bloquear.
- TLS direto no GitHub Actions: 1.0/1.1 recusados; 1.2/1.3 negociados com validação do certificado e hostname. O proxy do ambiente local não foi usado como prova de recusa de TLS antigo.
- Cinco testes negativos no domínio público: origem externa 403, tipo de conteúdo errado 415, corpo excessivo 413, injeção de cabeçalhos/destinatário 422 e honeypot 400. Todos sem aceitação ou envio de email.
- 37 pedidos de leitura HTTP adicionais confirmaram cabeçalhos, rotas, ausência de ficheiros internos, diagnóstico protegido e formulário desativado na origem GitHub. Os hashes do JS/CSS recebidos corresponderam ao código revisto.
- Navegação real PT/EN: três passos, seleção múltipla, resumo como texto literal, páginas legais e ausência de erros JavaScript da aplicação. A agenda foi observada em português na página PT.

As primeiras provas de fórmula falharam devido ao separador do locale `pt_PT`. O protocolo foi validado isoladamente com ponto e vírgula antes de aplicar a correção. O backend recusa novas inserções se o locale da folha deixar de ser o esperado. Nenhum pedido comercial foi alterado para fazer estes testes.

## Testes locais e dependências

- 236 testes Node aprovados na versão de trabalho final.
- 34 testes Python aprovados com instalação limpa dos ficheiros bloqueados; `pip check`, configuração Gunicorn e sintaxe YAML aprovados.
- Oito cenários de navegador simulados, PT/EN a 320/375/768/1440 px: sem transbordamento horizontal, execução de HTML, pedidos externos antes de abrir a agenda ou dados persistidos pela aplicação. Campos e resumos são limpos após aceitação; uma tentativa válida gera um único POST.
- Auditoria do histórico e ficheiros atuais por padrões conhecidos: sem ocorrências reais detetadas. A contagem final consta do fecho abaixo. O reconhecimento por padrões não prova a ausência de todos os tipos possíveis de segredos.
- 35 versões de bibliotecas consultadas na informação oficial de vulnerabilidades do PyPI: nenhuma indicação ativa conhecida. Isto não substitui atualização e acompanhamento contínuos.

## Limites e cuidados operacionais

1. **Não existe risco zero.** Atualizações, revisão de acessos, MFA nas contas de gestão, cópias de segurança e tratamento dos alertas continuam necessários. Esta revisão não verifica a configuração privada de MFA, regras da branch, âmbito efetivo de todos os tokens ou eliminação dos backups dos fornecedores.
2. **Limites nativos aproximados.** Os contadores Cloudflare são por origem/localização e o contador partilhado não é uma quota mundial estrita. Um ataque distribuído com pedidos válidos pode consumir quotas. O site falha de forma segura se Google/Resend ficarem indisponíveis e conserva os campos na página; não há uma fila de pedidos.
3. **Dependência do CRM.** O registo precede o email. Falhas/quota da Google ou o limite próximo de 10 000 linhas podem impedir o envio. Deve acompanhar-se a capacidade e reconciliar estados pendentes após falhas de confirmação.
4. **Pedidos antigos.** Linhas anteriores sem âncora continuam legíveis e deduplicáveis. O código evita atualizá-las por posição; estados pendentes antigos precisam de reconciliação manual. Novas linhas entram no início da lista. Os novos marcadores acompanham a linha; os marcadores antigos de âmbito de folha têm um ciclo de vida diferente. Não eliminar marcadores indiscriminadamente.
5. **Correio do domínio.** DMARC está em `p=none`, de monitorização; o seletor DKIM observado usa RSA 1024. Avaliar política mais restritiva e chave 2048 com o fornecedor depois de confirmar todos os emissores legítimos. Alterar estes registos sem essa verificação pode afetar correio legítimo.
6. **Privacidade e identificação.** A identificação jurídica completa continua por fornecer por decisão do proprietário. Não foram inventados ou publicados dados pessoais. A existência das páginas legais não garante conformidade RGPD ou cumprimento das obrigações de identificação. Conservação e eliminação devem abranger Gmail, Resend e Sheets.
7. **Calendly.** É carregado só após clique e recebe os seus próprios dados quando o visitante os preenche. O fornecedor disponibiliza português do Brasil, aceite pelo proprietário; não existe opção nativa pt-PT. As suas traduções, disponibilidade, cookies e tratamento interno dependem desse fornecedor. Escape com foco dentro do iframe pode não fechar a janela exterior; o botão de fechar e a navegação por teclado continuam disponíveis.

## Fecho da verificação

A comparação inicial do webhook falhou porque o código descarregado era o bundle, e não o ficheiro original. A compilação local sem publicação com Wrangler **4.160.0** reproduziu exatamente os **18 405 bytes** e SHA-256 `514ce85082d016a3892fbe7b41bf0a98d7dfb79b9045eb710d58543eafc26aa3` observados na Cloudflare. O código-fonte corresponde a `6543c37336924d142f8e9575d983de457e4debd3e7ecc5637c8ea6e20f3dfaba`.

O manifesto `workers/resend-webhook.build.json` associa estes hashes à configuração reproduzida. O verificador só aceita o código-fonte exato ou este bundle exato. Fonte, configuração ou manifesto desatualizados impedem a verificação antes de usar credenciais externas. Não se aceitam simples semelhanças, normalizações ou marcadores. Não foram acrescentadas dependências para verificar o bundle. Quando se alterar esse Worker, é necessário reproduzir e rever uma nova compilação antes de atualizar o manifesto; não basta substituir o hash pelo valor remoto.

A [verificação final do webhook em produção](https://github.com/timesaverautomate/time-saver/actions/runs/43031552899) passou: hash exato do bundle, quatro bindings, saúde pública, resposta 401 a evento sem assinatura e estado de exposição preservado. Esta execução fez **zero alterações à Cloudflare**. O fornecedor não devolveu os três campos de observabilidade consultados (`not_reported`); por isso, **não foi confirmado que os logs do Worker auxiliar estejam desativados**. A configuração do Worker público é distinta e foi verificada no fluxo do domínio.

A leitura final de `https://timesaverautomate.com/api/form-status` confirmou o formulário disponível e a emissão do ticket assinado. A página principal manteve HSTS de um ano, CSP restritiva com Trusted Types, proteção de enquadramento, `nosniff`, Referrer-Policy e Permissions-Policy.

No commit `a9770add`, a auditoria em Actions examinou **166 commits e 479 versões únicas de ficheiros de texto**, sem padrões de segredos reais detetados e sem imprimir valores. Os **236 testes Node** passaram também nessa execução. O resultado aplica-se a esse histórico alcançável e aos padrões documentados; não é uma prova universal de ausência de credenciais.

A tentativa de desativar a observabilidade do Worker auxiliar foi bloqueada pela revisão automática de aprovação, por exigir autorização específica para essa alteração persistente. A verificação final usa um script independente, apenas de leitura, sem uploads nem alterações de logs. Não se confunde a confirmação do código e da proteção de assinatura com a confirmação de logs desativados.
