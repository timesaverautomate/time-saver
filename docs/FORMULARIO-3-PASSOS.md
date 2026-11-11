# Pedido de orçamento em três passos

A secção de orçamento mantém a paleta azul-escura e verde-água e passa a apresentar:

1. **Contactos**: nome e email obrigatórios, empresa opcional.
2. **Projeto**: os mesmos serviços, orientação por tipo de ajuda, descrição e contexto opcional.
3. **Resumo**: confirmação dos contactos e projeto, com botões para editar antes do envio.

## Ficheiros alterados

- `public/index.html` e `public/en.html`: painéis, progresso, navegação e resumo nas duas línguas. Todos os controlos, identificadores, nomes, atributos de validação e opções do formulário anterior foram preservados. Não se acrescentaram campos pessoais.
- `public/styles.css`: painel com barra lateral no computador e progresso compacto no telemóvel. As regras ficam limitadas à secção do orçamento; os controlos ocultos não ocupam espaço.
- `scripts/preview-html.mjs`: mantém a remoção completa do formulário na versão histórica de pré-lançamento, incluindo as secções aninhadas dos passos.
- `public/app.js`: mudança de passos, validação antes de avançar, resumo criado com `createElement` e `textContent`, edição e foco nos erros. O pedido só é enviado pelo botão final.

O processamento, destinatário, Reply-To, Resend, CRM, limites do servidor, proteção da origem, honeypot e idempotência mantêm-se. Não se acrescenta armazenamento persistente do navegador nem informação pessoal ao URL.

## Verificações locais

- 173 testes automáticos e construção de publicação aprovados.
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
