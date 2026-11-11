# Pedido de orçamento em três passos

A secção de orçamento mantém a paleta azul-escura e verde-água e passa a apresentar:

1. **Contactos**: Nome/Empresa e email obrigatórios; sem campo de empresa separado.
2. **Projeto**: seleção de uma ou várias áreas de ajuda, orientação por tipo de ajuda, descrição e contexto opcional.
3. **Resumo**: confirmação dos contactos e projeto, com botões para editar antes do envio.

## Ficheiros alterados

- `public/index.html` e `public/en.html`: painéis, progresso, navegação e resumo nas duas línguas. O campo separado de empresa foi removido e o primeiro campo passou a Nome/Empresa. A seleção de ajuda permite várias opções; “Ainda não sei” é exclusiva. Mantêm-se os limites dos restantes campos e não se acrescentam dados pessoais.
- `public/styles.css`: painel com barra lateral no computador e progresso compacto no telemóvel. As regras ficam limitadas à secção do orçamento; os controlos ocultos não ocupam espaço.
- `scripts/preview-html.mjs`: mantém a remoção completa do formulário na versão histórica de pré-lançamento, incluindo as secções aninhadas dos passos.
- `public/app.js`: mudança de passos, validação antes de avançar, resumo criado com `createElement` e `textContent`, edição e foco nos erros. O pedido só é enviado pelo botão final.

O destinatário, Reply-To, Resend, colunas do CRM, limites do servidor, proteção da origem, honeypot e idempotência mantêm-se. O servidor aceita as novas seleções múltiplas através de uma lista limitada de valores permitidos e mantém a compatibilidade com pedidos anteriores de uma única área. Não se acrescenta armazenamento persistente do navegador nem informação pessoal ao URL.

## Verificações locais

- 180 testes automáticos e construção de publicação aprovados.
- PT/EN verificados em larguras de 320, 375, 768 e 1440 px, sem ultrapassar a largura do ecrã.
- Campos inválidos impedem o avanço; Enter nos primeiros passos não envia.
- A revisão mostra texto semelhante a HTML de forma literal, sem criar elementos ou executar código.
- Erros 422 do servidor revelam o passo e os detalhes corretos e colocam o foco no campo depois de este voltar a estar disponível.
- Falha 503 preserva os dados; a nova tentativa sem alterações conserva a chave de idempotência.
- Duplo clique gera apenas um pedido; os campos e o resumo com dados pessoais são limpos após a aceitação, mantendo a confirmação e a referência.
- “Criar outro pedido” reinicia o percurso e renova a sessão.
- A agenda integrada abre sem apagar o que foi preenchido no formulário.
- Testes com fornecedor simulado não constituem prova de entrega real de email.

## Confirmar o envio em produção

Abrir https://timesaverautomate.com/#orcamento, preencher um pedido interno claramente identificado como teste, percorrer os três passos e enviar uma vez. Comparar a referência apresentada com o email recebido em timesaverautomate@gmail.com e com o registo interno. Testar separadamente os estados de falha em ambiente simulado. Não alterar credenciais ou desligar fornecedores em produção para provocar falhas.

Estas verificações reduzem o risco de regressões; não constituem garantia de ausência de vulnerabilidades ou falhas futuras.

## Seleção de áreas

Os cartões permitem combinar as seis áreas específicas. “Ainda não sei” desmarca as restantes; escolher uma área específica desmarca essa opção. O resumo e o email apresentam todas as áreas escolhidas. No servidor, listas vazias, repetidas, demasiado extensas, com opções desconhecidas ou que misturem “Ainda não sei” com áreas específicas são rejeitadas. A ordem normalizada é estável e o CRM conserva a lista completa numa única coluna, com comprimento limitado.
