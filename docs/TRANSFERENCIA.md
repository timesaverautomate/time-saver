# Transferir a Time Saver para timesaverautomate

Destino autorizado pelo titular: timesaverautomate/time-saver.

Estado: transferência confirmada para timesaverautomate/time-saver, com o ID original 1452563434. A nova conta está ligada à integração GitHub desta conversa e o acesso administrativo ao repositório foi verificado. As instruções abaixo ficam como registo do procedimento.

## Operação de transferência

1. Com sessão em usertechsitee, abra https://github.com/usertechsitee/time-saver/settings.
2. No fim da página, na secção Danger Zone, escolha Transfer.
3. Em New owner, escolha Specify an organization or username e indique timesaverautomate.
4. Mantenha o nome time-saver e confirme com o nome pedido pelo GitHub.
5. Aceite a transferência através da mensagem enviada à conta timesaverautomate. O GitHub indica que o convite expira ao fim de um dia.

Não crie outro repositório time-saver na conta de destino antes da transferência: um repositório com o mesmo nome impede a operação. Não é necessário apagar o repositório original para o mover.

Segundo a documentação do GitHub, a transferência preserva commits, histórico e os segredos associados ao repositório. A receção dos emails de teste já tinha sido validada antes da transferência. Não é necessário publicar a chave Resend nem recriá-la num ficheiro.

O diagnóstico de email foi adaptado para verificar o ID estável do repositório (1452563434), em vez de exigir o nome do proprietário anterior. Os pedidos ao GitHub usam o nome atual fornecido pelo workflow. Esta preparação não altera o destinatário nem expõe a chave.

## Depois de aceitar

- Confirmar que https://github.com/timesaverautomate/time-saver mostra os ficheiros e o histórico.
- Confirmar o segredo RESEND_API_KEY em Settings → Secrets and variables → Actions, sem divulgar o seu valor.
- Ligar a conta timesaverautomate à integração GitHub desta conversa e dar acesso ao projeto, para permitir a continuação do trabalho.
- Atualizar referências operacionais e a preparação de GitHub Pages para o novo proprietário.
- Verificar permissões de colaboradores. O GitHub pode manter o proprietário anterior como colaborador após a transferência; essa configuração deve corresponder à decisão do titular.
- Manter o repositório privado até existir uma decisão explícita sobre a sua visibilidade. GitHub Free não disponibiliza Pages para repositórios privados. Nenhum plano pago foi contratado.

A transferência do código não ativa o formulário comercial. O alojamento, as condições de GitHub Pages, o backend, o remetente de produção e os dados legais continuam a exigir as configurações anteriormente documentadas.

Fonte oficial: https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository
