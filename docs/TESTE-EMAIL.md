# Testar o Resend sem partilhar a chave no chat

Este procedimento utiliza GitHub Actions como ferramenta operacional. Não acrescenta autenticação, um painel de gestão ou novas páginas ao website. Não ativa o formulário comercial.

## Guardar a chave

1. Na conta Resend criada com timesaverautomate@gmail.com, abra API Keys e crie uma chave chamada Time Saver, com permissão Sending access.
2. Abra https://github.com/usertechsitee/time-saver/settings/secrets/actions com a conta GitHub usertechsitee.
3. Escolha New repository secret.
4. No campo Name escreva RESEND_API_KEY.
5. No campo Secret cole a chave real do Resend. Não cole a chave em mensagens, ficheiros, issues, screenshots ou commits.
6. Clique em Add secret.

O valor fica guardado como segredo do repositório e é disponibilizado apenas ao passo do workflow que executa o teste. Não é incluído no código enviado ao navegador. O GitHub protege o valor guardado; mantenha os acessos ao repositório e às contas restritos.

## Executar o teste

1. Abra Actions no repositório.
2. Escolha Testar envio de email.
3. Clique em Run workflow, selecione main e confirme Run workflow.
4. Abra a execução e o passo Enviar teste para o titular da conta Resend.
5. Se o serviço aceitar o envio, aparece accepted: true e um identificador do fornecedor. Confirme a mensagem no Gmail e na pasta de spam antes de considerar a receção validada.

O teste usa o remetente onboarding@resend.dev e o destinatário fixo timesaverautomate@gmail.com. O Resend só permite este remetente de teste para o email da própria conta. Não há envio para visitantes nem respostas automáticas. A referência e o corpo mantêm-se estáveis nas execuções do mesmo dia UTC para aplicar a idempotência do fornecedor.

O workflow só é executado manualmente por um operador autorizado. Não é executado por submissões públicas nem por pull requests. A chave não é impressa; perante falha, são mostradas apenas mensagens de diagnóstico e, quando disponível, o código HTTP.

## Âmbito e configurações pendentes

Guardar um segredo em GitHub Actions não configura automaticamente o segredo de produção do Sites/Cloudflare. Este passo permite testar a conta Resend de forma protegida enquanto não existe um domínio próprio.

O formulário comercial mantém-se desativado. A ativação continua a depender de um remetente de produção verificado, configuração do segredo no alojamento, armazenamento técnico de proteção, dados legais completos e validação real do fluxo. Não foi enviado qualquer email durante a preparação deste procedimento.

Referências oficiais:

- https://resend.com/docs/knowledge-base/403-error-resend-dev-domain
- https://resend.com/docs/dashboard/api-keys/introduction
- https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions
