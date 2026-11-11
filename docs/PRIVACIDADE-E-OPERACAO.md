# Privacidade, segurança e operação

> Nota de arquitetura: as referências a D1 e ao adaptador de email original abaixo são históricas. O site público atual usa GitHub Pages e o Worker `src/site-proxy.mjs`, contadores nativos da Cloudflare, Resend e o CRM privado em Google Sheets. Consulte [FORMULARIO-EMAIL.md](FORMULARIO-EMAIL.md), [SEGURANCA-VALIDACAO-2026-11-11.md](SEGURANCA-VALIDACAO-2026-11-11.md) e a auditoria final para o funcionamento verificado. Não interpretar os limites ou prazos históricos de D1 como configuração ativa.

## Decisões de arquitetura

Na instalação GitHub Pages, o browser envia JSON para um endpoint HTTPS explicitamente configurado. A API separada valida a origem exata e aplica CORS restrito; isto não é uma proteção suficiente contra bots. O modo original da mesma origem continua suportado. Não existem sessões, contas, ficheiros anexos ou fluxos de pagamento. O servidor valida, aplica limites e bloqueios e envia um email de texto através de Resend. Os pedidos completos não são gravados em D1.

O Resend é a integração implementada por suportar envio HTTP e chaves de idempotência. Não é apresentado como fornecedor integralmente sediado ou processado no EEE. Rever o DPA, as entidades, as regiões, a lista de subcontratantes, os acessos e as garantias internacionais antes da ativação. Se não for adequado, substituir o adaptador src/mail.mjs e repetir os testes, incluindo a semântica de idempotência do novo fornecedor.

## Fundamentos jurídicos a documentar

| Situação | Base avaliada | Condições |
| --- | --- | --- |
| Particular que pede proposta para si | Art. 6.º/1/b RGPD | Diligências pré-contratuais pedidas pelo titular, limitadas ao necessário |
| Representante que contacta em nome de uma empresa | Art. 6.º/1/f | Interesse legítimo na gestão de um pedido recebido; documentar necessidade e ponderação |
| Contadores e identificadores contra abuso | Art. 6.º/1/f | Proteger o serviço; minimizar dados, limitar conservação e ponderar impacto |

Não tratar a identidade do representante como se a pessoa fosse automaticamente parte no contrato da empresa. Não acrescentar uma checkbox de autorização genérica ou de marketing. Qualquer futura finalidade diferente exige avaliação e atualização da informação.

### Minuta de avaliação de interesse legítimo

- Finalidade concreta: analisar e responder a contactos profissionais iniciados pelo próprio representante; proteger um formulário público e a caixa de email.
- Necessidade: sem contacto e contexto mínimos não é possível esclarecer a proposta; sem estado técnico partilhado o serviço fica exposto a abuso e duplicação.
- Expectativas: o visitante inicia um pedido e espera uma resposta sobre esse pedido. Não se prevê marketing, perfilagem ou reutilização de contactos.
- Impacto: dados de contacto e descrição geral; risco de inclusão inadvertida de dados de terceiros; IPs partilhados podem levar a limitação de utilizadores legítimos.
- Salvaguardas: aviso para não enviar informação confidencial, sem anexos, poucos campos, detalhes opcionais, email de texto, acesso restrito, retenção limitada, oposição e canal para direitos.
- Alternativas ponderadas: não guardar o conteúdo numa base; não exigir registo; não instalar um desafio externo por defeito.
- Resultado, aprovação e revisão: **[PREENCHER PELO RESPONSÁVEL, COM DATA E JUSTIFICAÇÃO]**.

Esta minuta não substitui a avaliação factual pelo responsável.

## Retenção e eliminação

**Proposta para aprovação:** seis meses após o último contacto relevante para pedidos que não originem contrato. A razão é permitir acompanhamento de propostas e retoma de conversas sem conservar todos os contactos indefinidamente. Não é um prazo legal universal.

Depois de aprovado, configurar uma rotina mensal de revisão e eliminação da caixa. Incluir inbox, enviados, marcadores, lixo, exportações e cópias de trabalho. Documentar eventuais exceções por contrato, obrigações legais ou defesa de direitos e rever a sua necessidade.

No D1, os contadores têm janelas fixas de até uma hora e os bloqueios têm validade de 23 horas. A limpeza acontece na submissão, na emissão de códigos e a cada hora pela tarefa agendada. O cron ativo limita a conservação física prevista a menos de 24 horas. Confirmar alertas da tarefa; se falhar, eliminar expirados e reparar.

As impressões HMAC derivadas de IP e conteúdo são pseudónimos e continuam abrangidas por proteção de dados. Só a chave do servidor permite voltar a calcular os mesmos identificadores. Proteger essa chave e os acessos ao D1.

O código não cria logs de aplicação com nomes, emails, IPs ou mensagens. Observabilidade automática do Worker está desativada no ficheiro de configuração. O edge e os fornecedores podem manter metadados próprios. Confirmar duração e eliminação de logs e backups nas contas reais; não pressupor que a configuração da aplicação elimina os registos do fornecedor.

## Fornecedores a confirmar

- GitHub Pages: condições de alojamento, destinatários e metadados de rede, logs, acessos e garantias internacionais aplicáveis. Confirmar também a adequação do Pages à utilização comercial pretendida.
- Cloudflare: DPA, entidades, subcontratantes, condições de localização, acesso administrativo, logs e eventuais transferências internacionais.
- Resend: DPA, destinatários, retenção do conteúdo e metadados, acessos, subcontratantes e garantias de transferência.
- Google/Gmail: a caixa indicada é Gmail. Não pressupor que uma conta pessoal disponibiliza os mesmos compromissos contratuais de uma conta empresarial. Verificar a posição contratual e a adequação; se necessário adotar uma caixa profissional com condições adequadas, alterando MAIL_TO no servidor.
- Sites: a identificação do projeto é uma cópia de revisão sem email ativo. Se for utilizada uma versão privada da plataforma, avaliar também os tratamentos e tecnologias de acesso próprios dessa plataforma. O destino escolhido pelo titular é GitHub Pages para o frontend e um Worker separado para a API.

Preferir processamento no EEE quando adequado e confirmar também subcontratantes e acessos internacionais. Uma região europeia de infraestrutura ou de envio não basta para concluir que todo o tratamento fica no EEE.

Documentar os contratos aplicáveis e as garantias confirmadas antes de preencher as páginas legais. Referências: RGPD (Regulamento UE 2016/679), Lei 58/2019, legislação nacional sobre tecnologias de acesso ao terminal, deveres de identificação do prestador e, quando aplicável, Lei 144/2015 e regime do Livro de Reclamações. Confirmar os requisitos concretos da atividade. A antiga plataforma europeia ODR/RLL não deve ser apresentada como mecanismo ativo.

## Proteções implementadas

- JSON limitado a 16 KiB, lido por fluxo com limite efetivo, sem anexos e sem corpos comprimidos.
- Tipos, formatos, comprimentos e opções validados no servidor; campos desconhecidos rejeitados.
- Nome, empresa e email sem quebras de linha; caracteres de controlo rejeitados.
- Destinatário, remetente e assunto definidos no servidor. Email do visitante apenas em Reply-To. Corpo exclusivamente texto.
- Origem HTTPS exata, verificação de Sec-Fetch-Site quando presente e código temporário HMAC com validade de duas horas e espera mínima de 1,5 segundos. Sem cookies de sessão.
- Honeypot oculto, inert, fora da navegação por teclado e da árvore acessível.
- Contadores atómicos em D1: 8 tentativas por IP pseudonimizado/15 minutos, 30 tentativas globais/minuto e 150/hora. Emissão de códigos: 30 por origem/minuto e 200 globais/minuto.
- Janelas fixas: podem permitir uma rajada maior na fronteira entre janelas. Rever os valores com tráfego real; redes empresariais podem partilhar IP.
- Unicidade em D1 e lease de 30 segundos para impedir concorrência. Impressão criptográfica do conteúdo para evitar que uma nova chave contorne o mesmo pedido.
- Idempotência de email com referência estável e corpo determinístico nas novas tentativas. Janela local de 23 horas, inferior à janela documentada de 24 horas do fornecedor; confirmar essa condição antes de ativar. Passada essa janela, o pedido é considerado novo.
- Estado de sucesso apenas após resposta positiva com identificador do fornecedor, ou repetição de um pedido com aceitação já registada.
- Se a aceitação acontecer e a resposta se perder, o servidor reutiliza a mesma referência na nova tentativa. Se o serviço estiver indisponível, não existe uma fila que conserve o conteúdo: o visitante deve manter a página aberta e tentar novamente.
- Cabeçalhos CSP, X-Frame-Options, nosniff, Referrer-Policy e Permissions-Policy. HSTS opcional após preparar o domínio.

Estas medidas não tornam o serviço “100% seguro”. Os testes automatizados não são uma auditoria OWASP completa nem uma certificação.

## Operação e manutenção

1. Ativar MFA nas contas GitHub, alojamento, DNS, email e serviço de envio; limitar acessos e rever permissões.
2. Dar à integração de construção acesso apenas ao repositório necessário. Utilizar chaves de envio e gestão com o menor âmbito possível.
3. Proteger a caixa Gmail, evitar encaminhamentos não controlados e rever acessos de aplicações externas.
4. Rever periodicamente Node, Wrangler, ações CI, fornecedor de email e políticas do edge. Não há dependências de produção da aplicação, mas as ferramentas e a infraestrutura precisam de manutenção.
5. Monitorizar falhas e rejeições de envio através dos metadados do fornecedor, sem copiar mensagens para logs ou URLs. Correlacionar apenas pela referência quando necessário.
6. Distinguir envio aceite, entregue, rejeitado e devolvido. O website só confirma a aceitação. Não prometer prazos de resposta.
7. Em falha continuada, desativar MAIL_ENABLED e publicar a configuração; o formulário apresenta indisponibilidade e não simula sucesso.
8. Confirmar a execução do cron e limpar registos expirados em falha. Rever os dados mantidos pelos fornecedores.
9. Se houver abuso persistente, avaliar primeiro limites e regras do edge. Só acrescentar um desafio externo depois de avaliar acessibilidade e privacidade, validar no servidor e atualizar a política de cookies.
10. Manter um procedimento para direitos dos titulares e incidentes, com avaliação dos deveres de notificação que efetivamente se apliquem.

As contas de gestão são ferramentas operacionais externas. Não existe qualquer painel administrativo ou autenticação no website da Time Saver.
