# TimeSaver — envio automático Gmail com objetivo de 30 emails/dia

## Estado (13/11/2026)
- Implementado `scripts/gmail_outreach.py` e agendamento `.github/workflows/gmail-outreach.yml`.
- Em modo **inativo por defeito**: o GitHub **não** dispõe ainda de autorização OAuth de envio da conta `timesaverautomate@gmail.com`; a ligação Gmail do ChatGPT é uma conta distinta e **não** concede tokens ao GitHub.
- A auditoria ao CRM identificou **0 contactos com opt-in documentado**; nenhum envio de produção foi realizado.
- O motor realiza testes offline; envio real só depois da configuração manual das credenciais, alteração da variável de ativação e existência de registos autorizados.
- O Resend permanece para comunicações transacionais e reconciliação; as suas campanhas comerciais agendadas foram desativadas, evitando dois fornecedores a enviar no mesmo CRM.

## Sequência de crescimento por dia útil

| Semana (começa) | Teto por dia útil |
| --- | ---: |
| 16/11/2026 | 5 |
| 23/11/2026 | 10 |
| 30/11/2026 | 15 |
| 07/12/2026 | 20 |
| 14/12/2026 e seguintes | 30 |

**Teto, não meta obrigatória.** Enviam-se apenas as mensagens para contactos elegíveis que existem efetivamente no CRM, mesmo que isso seja zero. A quota já conta emails comerciais registados no CRM noutro fornecedor nesse mesmo dia. A execução ocorre nos dias úteis às 10:15 UTC (no horário de verão, às 11:15 em Portugal continental).

## Teste de integração — 13/11/2026

- GitHub Actions: https://github.com/timesaverautomate/time-saver/actions/runs/43450611325
- **80 testes unitários passaram.** Incluem: limite por semana, OAuth de conta incorreta, recusa sem prova, deduplicação, reserva técnica, MIME Gmail e simulação de timeout.
- O job `crm_preview_real` executou com autenticação do Google Sheets: **26 contactos verificados, 0 autorização comercial elegível, 0 envios**.
- **Nenhuma chamada à API Gmail de produção foi feita.** A ligação OAuth do remetente não está criada nos segredos deste GitHub; a variável de ativação permanece por configurar.

## 1. Autorizar timesaverautomate@gmail.com — OAuth (ação do titular)

1. Entrar em https://console.cloud.google.com/ com a conta TimeSaver e criar/selecionar projeto. Ativar a **Gmail API** em APIs e serviços.
2. Configurar o ecrã de consentimento OAuth. Para testes, adicionar a própria conta como utilizador de teste. Atenção: com publicação *Testing* e scopes Gmail, os refresh tokens podem expirar em **7 dias**. Para produção, escolher o estado de publicação aplicável, cumprir eventuais requisitos de verificação e segurança da Google.
3. Criar um **OAuth Client ID**, tipo **Web application**, e adicionar **exatamente** o URI de redirecionamento `https://developers.google.com/oauthplayground`.
4. Abrir https://developers.google.com/oauthplayground/. Na engrenagem de configuração escolher **Use your own OAuth credentials**, **Server-side**, **Offline**; preencher Client ID/Secret **diretamente aí**, sem os partilhar na conversa.
5. Em *Step 1*, pedir apenas os scopes `openid email https://www.googleapis.com/auth/gmail.send` e autorizar com **timesaverautomate@gmail.com**. Em *Step 2*, trocar o código por um **Refresh Token**.
6. Em https://github.com/timesaverautomate/time-saver/settings/secrets/actions adicionar **Repository secrets**:
   - `GMAIL_OAUTH_CLIENT_ID`
   - `GMAIL_OAUTH_CLIENT_SECRET`
   - `GMAIL_OAUTH_REFRESH_TOKEN`
   - Manter o `GOOGLE_SERVICE_ACCOUNT_JSON` existente para o Google Sheets.
7. Em *Actions → Variables*, criar `GMAIL_SEND_ENABLED` com valor **false** durante o teste inicial. Só mudar para **true** após confirmar identidade, autorizações e prova de consentimento no CRM. Nunca incluir tokens em ficheiros do repositório, mensagens, capturas de ecrã ou logs públicos.
8. GitHub Actions → **TimeSaver - Gmail opt-in (rampa 5 a 30)** → *Run workflow* → **preview**. Rever o número de contactos e as razões de bloqueio. Em seguida, quando devidamente configurado, executar **send** e escrever **ENVIAR** no campo de confirmação para fazer um teste de produção com contacto realmente autorizado. A ativação de `GMAIL_SEND_ENABLED=true` também permitirá a execução agendada.

A implementação obtém um access token novo por refresh token e consulta a identidade via **OpenID Connect userinfo**. Se a conta autenticada não for exatamente `timesaverautomate@gmail.com`, o envio é bloqueado. Usa apenas o scope sensível `gmail.send` para enviar; não lê nem elimina emails.

## 2. Evidência exigida por contacto

O CRM continua a não aprovar empresas automaticamente. No separador **Pedidos**:
- `E`: caixa de email genérica, num domínio igual ao website indicado em `D`;
- `X`: `Consentimento documentado`;
- `Y`: `Não`, sem oposição anterior;
- sem outro envio registado na mesma empresa/domínio.

No separador **Revisão Comercial** a revisão da mesma linha requer:
- `I`: `Verificado`;
- `J`: `Consentimento documentado`;
- `K`: incluir ambos `OPTIN_PROVA=https://...; OPTIN_DATA=AAAA-MM-DD` para apontar à prova real e datada de aceitação do contacto comercial; **nunca preencher automaticamente**;
- `L`: número da linha original do CRM, nome/email/website coincidentes;
- `O`: data da última confirmação do email (máximo 90 dias);
- `P`: fonte de confirmação do contacto;
- `Q`: `Aprovado`;
- `S`: data recente da aprovação humana (máximo 30 dias).

O consentimento tem de cobrir a finalidade comercial pretendida. `OPTIN_PROVA` não é apenas uma URL inventada: deve identificar uma prova que a equipa efetivamente consegue consultar e demonstrar; a aplicação faz validação **de formato**, não verifica autonomamente a legitimidade do documento. O registo de autorização deve ser revogado se a empresa retirar o consentimento.

## 3. Segurança, limites e acompanhamento

1. A execução `preview` lê CRM e revisões, mostra contagens e **não** chama a API do Gmail.
2. A execução `send` só funciona no repositório/ramo e workflow aprovados e com `GMAIL_SEND_ENABLED=true`.
3. Cada contacto é revalidado antes de reservar e novamente após a reserva. Uma marca técnica `Reservado: ...` é gravada em `V` antes da chamada Gmail. Em timeout ou erro de rede, a marca fica: é necessário reconciliar manualmente antes de tentar novo envio; **não reenvia automaticamente**.
4. Com confirmação Gmail, regista `Enviado Gmail`, data, contador e `gmail:<id>`. Isso significa que a API **aceitou** a mensagem, **não** que foi entregue ou lida.
5. O Gmail pessoal e o Resend são sistemas distintos: `gmail:<id>` impede que um ID Gmail seja consultado como ID Resend na reconciliação deste.
6. **Rever diariamente** respostas, erros de entrega, denúncias de spam e oposição na caixa Gmail, registando bloqueios em `Pedidos!Y`. O módulo `gmail.send` não lê respostas nem bounces automaticamente. Suspender a ativação `GMAIL_SEND_ENABLED` se surgirem problemas e só continuar quando forem analisados. Não estão implementados follow-ups automáticos.
7. A rampa só aumenta o teto, **não** flexibiliza os requisitos de consentimento, setor ou dimensão. Os limites da conta Google e a política contra spam prevalecem sobre o objetivo numérico.

## Referências oficiais

- https://support.google.com/mail/answer/16734397?hl=pt (Gmail: proibição de spam/correio comercial não solicitado)
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send (Gmail API)
- https://developers.google.com/workspace/gmail/api/auth/scopes (scope `gmail.send`)
- https://developers.google.com/identity/openid-connect/openid-connect (verificação de identidade `email`)
- https://developers.google.com/identity/protocols/oauth2/web-server (refresh tokens e acesso offline)
- https://developers.google.com/identity/protocols/oauth2 (validade de tokens de teste)
