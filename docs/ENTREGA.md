# Entrega, configuração e publicação

## Estado atual

O código está preparado para o repositório privado usertechsitee/time-saver. O website e o backend estão implementados. O destinatário escolhido é timesaverautomate@gmail.com.

**O envio não está ativo e não foi testada a receção de email real.** Não existem credenciais de email, um domínio de remetente verificado, acesso ao alojamento final ou dados legais completos nesta sessão. As páginas legais contêm marcadores explícitos. A publicação comercial deve aguardar a resolução destes pontos.

Nada foi comprado. Não foram criadas pastas no seu PC. O trabalho foi preparado numa área de trabalho na nuvem e entregue no GitHub.

## Lista do que falta e como resolver

| Pendente | Como resolver | Onde alterar |
| --- | --- | --- |
| Identificação da empresa | Confirmar denominação, NIF/NIPC, morada profissional, registo e contactos aplicáveis | public/aviso-legal.html e public/privacidade.html |
| Contacto de privacidade | Escolher um endereço monitorizado e um responsável pelas respostas | public/privacidade.html |
| RAL e reclamações | Avaliar a atividade e os destinatários, incluindo particulares, e inserir os elementos aplicáveis | public/aviso-legal.html |
| Domínio do site e do remetente | Usar um domínio que controla; comprar um domínio exige uma decisão sua e não foi feito | Alojamento, DNS e Resend |
| Serviço de email | Criar ou usar uma conta Resend, confirmar condições e manter plano sem custos se adequado | Painel Resend |
| DNS de email | Aplicar os registos indicados pelo fornecedor e verificar alinhamento | Gestor DNS |
| Credencial de envio | Criar chave restrita a envio e ao domínio escolhido | Segredos Cloudflare, nunca GitHub ou frontend |
| Estado técnico partilhado | Criar D1 e aplicar o esquema fornecido | Cloudflare D1 e wrangler.jsonc |
| Privacidade dos fornecedores | Rever contratos, subcontratantes, transferências, caixa Gmail e retenção | docs/PRIVACIDADE-E-OPERACAO.md e páginas legais |
| Ativação | Só depois dos passos anteriores, configurar as flags do servidor e validar | Configuração do Worker |
| Email real | Efetuar pedido e confirmar entrada na caixa, incluindo spam | Formulário, Resend e Gmail |
| Navegadores e acessibilidade | Testar telemóvel, tablet, computador, teclado e leitor de ecrã | Domínio de teste/final |
| Cookies do alojamento | Inventariar num navegador limpo, sem sessão privada da plataforma | Página de cookies e ferramentas do navegador |

## Fazer tudo no navegador

Pode editar o código no próprio GitHub (abrir um ficheiro e usar Edit, ou a tecla ponto para abrir o editor web). As alterações são guardadas como commits. Nunca edite diretamente o ficheiro gerado dist/server/index.js: altere public/ ou src/ e deixe a construção gerar o resultado.

O workflow de verificação em Actions executa os testes e a construção. Não publica o site. O preflight de publicação é separado para manter os testes utilizáveis enquanto os dados legais estão pendentes.

## 1. Completar a informação legal

Procure os marcadores entre parênteses retos nas três páginas legais. Complete-os com dados reais e retire as indicações de documento em preparação depois da revisão. No rodapé de public/index.html, substitua a nota de revisão por identificação legal real e ligação ao Aviso Legal.

Na Política de Privacidade, aprove ou ajuste a proposta de seis meses para pedidos sem contrato e descreva os prazos efetivos dos fornecedores, logs e backups. Não basta remover os parênteses: os factos e configurações devem corresponder ao texto.

Documente a avaliação de interesse legítimo para contactos de representantes de empresas e para a proteção do formulário. Confirme as obrigações aplicáveis a consumidores antes de aceitar esses projetos.

## 2. Configurar o email

O Gmail indicado é o **destinatário**, não o remetente automático. Não é possível verificar o domínio gmail.com como se pertencesse à Time Saver. Use um domínio seu para enviar, por exemplo um subdomínio dedicado a mensagens transacionais.

1. Entre em https://resend.com/ e confirme as condições e limites do plano escolhido. Não ative upgrades ou faturação para completar este guia.
2. Adicione um domínio de envio que controle. O exemplo pedidos@exemplo.pt é apenas ilustrativo e é rejeitado pela configuração do código.
3. Copie os registos DNS produzidos pelo painel e espere pela verificação. Não invente seletores ou valores.
4. Crie uma chave de envio com o menor âmbito permitido pelo fornecedor, idealmente restrita ao domínio.
5. Guarde a chave diretamente no gestor de segredos do Cloudflare Worker. Não a envie por chat nem a guarde em ficheiros do repositório.

### SPF, DKIM e DMARC

- **SPF:** aplique o registo e o domínio/subdomínio indicados pelo fornecedor. Evite criar dois registos SPF no mesmo nome. Se já existe SPF, reveja a combinação com o administrador DNS. Não substitua cegamente o SPF do email que já utiliza.
- **DKIM:** publique os registos com os seletores e chaves exatos do painel e confirme o estado verificado.
- **DMARC:** defina a política no domínio apropriado e confirme alinhamento do domínio visível no From com SPF ou DKIM. Pode começar com política de monitorização p=none, avaliar relatórios com uma caixa autorizada e depois endurecer para quarantine/reject quando todos os fluxos legítimos estejam alinhados. A caixa de relatórios e as implicações de tratamento dos relatórios devem ser avaliadas.
- Verifique em mensagens reais os resultados SPF/DKIM/DMARC. Uma resposta positiva da API não garante entrega nem impede classificação como spam.

Referência do fornecedor: https://resend.com/docs/dashboard/domains/introduction

## 3. Criar o armazenamento técnico no Cloudflare

1. Use uma conta Cloudflare e mantenha o plano gratuito se este cobrir a necessidade. Não foi subscrito qualquer plano.
2. Em Workers & Pages / D1, crie uma base chamada time-saver-security. Se a interface permitir localização, prefira uma localização europeia adequada e confirme o respetivo alcance contratual; uma indicação de localização não garante ausência de transferências.
3. Abra a consola SQL dessa base. Execute, por ordem, as instruções de migrations/0001_security.sql. Estas criam duas tabelas técnicas e os índices. Não crie tabelas de pedidos.
4. Copie o ID da base e substitua SUBSTITUIR_PELO_ID_D1 em wrangler.jsonc, mantendo o binding DB.
5. O cron horário de wrangler.jsonc faz a limpeza. Confirme que foi criado no Worker depois da publicação.

O esquema de migrations/ é utilizado pelo Wrangler em instalações posteriores. Se o esquema inicial tiver sido criado pela consola, a migração CREATE IF NOT EXISTS pode ser aplicada pelo Wrangler para registar o seu estado. Futuras alterações exigem novas migrações, nunca a modificação retroativa de migrações aplicadas.

## 4. Ligar o repositório ao alojamento

1. No Cloudflare, selecione a criação/importação de um **Worker** a partir de GitHub. Dê acesso apenas a usertechsitee/time-saver.
2. Diretório do projeto: raiz do repositório.
3. Comando de construção: npm run check && npm run preflight.
4. Comando de publicação: npx --yes wrangler@4 deploy.
5. Se a plataforma exigir um comando de instalação, não há dependências de aplicação; pode deixá-lo vazio. O construtor usa apenas módulos nativos Node.
6. Use Node 24 na configuração do ambiente de construção.

O preflight impede a publicação enquanto encontrar marcadores ou notas de revisão. Esta verificação é uma ajuda operacional, não uma garantia de conformidade. Não remova o comando para contornar dados pendentes.

Em alternativa, um técnico pode publicar a partir de um terminal na nuvem, com Wrangler autenticado, depois de executar as mesmas verificações. Não é necessário um terminal no seu PC.

### Variáveis e segredos

| Nome | Valor/configuração | Tipo |
| --- | --- | --- |
| PUBLIC_ORIGIN | A origem HTTPS exata, por exemplo https://www.seudominio.pt, sem barra final | Configuração do servidor |
| MAIL_TO | timesaverautomate@gmail.com | Configuração do servidor |
| MAIL_FROM | Time Saver &lt;pedidos@DOMINIO_VERIFICADO&gt; | Configuração do servidor |
| RESEND_API_KEY | Chave real com permissão de envio | Segredo |
| SECURITY_HMAC_KEY | 32 bytes aleatórios ou mais, codificados como 64 caracteres hexadecimais ou equivalente forte | Segredo |
| MAIL_ENABLED | true só depois de configurar o email | Configuração do servidor |
| LEGAL_READY | true só após rever e completar os documentos e fornecedores | Configuração do servidor |
| HSTS_ENABLED | true depois de confirmar o funcionamento permanente do domínio em HTTPS | Configuração do servidor |

Gere SECURITY_HMAC_KEY num gestor de segredos adequado ou num terminal seguro na nuvem com o gerador criptográfico do sistema. Não use o valor previsível dos testes.

As variáveis não secretas versionadas podem ficar em vars de wrangler.jsonc. As variáveis desse ficheiro voltam a ser aplicadas em cada deploy: atualize PUBLIC_ORIGIN e as flags nesse ficheiro quando estiver pronto, para que uma nova publicação não as volte a desativar. Pode manter MAIL_FROM e MAIL_TO apenas no servidor, desde que o processo de publicação preserve essa configuração.

Os segredos são definidos no painel do Worker ou através de wrangler secret put em ambiente de gestão. Não coloque chaves no campo vars de um ficheiro versionado. Aplique cada segredo no ambiente correto e volte a publicar quando a plataforma o exigir.

Antes de ativar, confirme o binding DB, as tabelas, a tarefa horária e que o edge fornece CF-Connecting-IP. O backend falha de forma fechada se não conseguir aplicar os limites.

## 5. Domínio e HTTPS

Associe o domínio/subdomínio que controla à rota ou ao domínio personalizado do Worker e aplique os registos indicados pelo Cloudflare. Não foram alterados registos DNS nesta entrega.

Confirme HTTPS, certificado válido e encaminhamento do domínio alternativo para o domínio principal. PUBLIC_ORIGIN deve ser exatamente a origem que serve o formulário. O backend só aceita esse Origin; redirecione variantes como domínio com/sem www antes de apresentar a página.

Ative o redirecionamento HTTPS no edge. Ative HSTS_ENABLED só depois de verificar o domínio. A política preparada dura um ano e não inclui includeSubDomains nem preload; só acrescente esses parâmetros se todos os subdomínios estiverem preparados.

## 6. Pré-visualização para partilha e pesquisa

O site inclui título, descrição, favicon SVG e desenho para partilha em public/partilha.svg, já exportado para public/partilha.png (1200 × 630). O construtor inclui os bytes da imagem no Worker. Antes de lançar, altere og:image para o URL HTTPS absoluto dessa imagem no domínio real e confirme a apresentação nas plataformas de partilha.

Defina também o URL canónico e og:url com o domínio real. Não foi inventado um domínio para estes metadados. Enquanto LEGAL_READY não for true, o Worker emite noindex/nofollow e robots.txt impede indexação.

## 7. Validar antes de abrir ao público

- Faça uma submissão válida com dados de teste não sensíveis e confirme a mensagem no Gmail, incluindo spam. Compare a referência com o email recebido.
- Confirme o destinatário fixo, remetente verificado, assunto fixo e Reply-To do visitante.
- Verifique SPF, DKIM e DMARC nos cabeçalhos da mensagem.
- Confirme que um duplo clique ou repetição do mesmo pedido não gera dois emails.
- Teste uma falha controlada do fornecedor em ambiente de teste; os dados devem manter-se na página e a nova tentativa deve reutilizar a mesma referência.
- Verifique que entradas inválidas são rejeitadas pelo servidor e não apenas pelo navegador.
- Verifique os limites globais e por origem no ambiente real, sem gerar tráfego desnecessário contra produção.
- Faça as verificações de telemóvel, teclado, leitor de ecrã, cookies, HTTPS e cabeçalhos de docs/VALIDACAO.md.

Só depois assinale estas verificações como concluídas. Uma resposta aceite pela API não comprova a receção na caixa. Não existem respostas automáticas aos visitantes nesta versão.
