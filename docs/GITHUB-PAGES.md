# Alojamento da Time Saver no GitHub Pages

Destino solicitado: timesaverautomate/time-saver.

Endereço previsto: https://timesaverautomate.github.io/time-saver/

O endereço só deve ser apresentado como ativo depois de publicação concluída e verificação HTTP. A preparação local e a exportação não comprovam que o repositório já esteja ligado a esta conversa ou que o site esteja publicado.

## Ligar o repositório e ativar Pages

1. Nas definições do ChatGPT, abrir Plugins ou Apps e selecionar GitHub.
2. Em contas ligadas, usar a opção para ligar outra conta, quando disponível, e entrar como timesaverautomate.
3. Autorizar a aplicação GitHub a aceder ao repositório time-saver. Uma transferência de propriedade não concede esse acesso automaticamente.
4. No GitHub, abrir https://github.com/timesaverautomate/time-saver/settings/pages e selecionar GitHub Actions como Source, se a conta e a visibilidade do repositório forem elegíveis.

Concluído: a conta timesaverautomate foi ligada e o acesso administrativo ao repositório foi confirmado. O titular tornou o repositório público e ativou Pages com origem GitHub Actions. A API Pages respondeu 200; ainda sem domínio personalizado ou deploy concluído. Não é necessário repetir a associação nem partilhar palavras-passe ou chaves com o chat.

## Plano e visibilidade

No GitHub Free, Pages está disponível para repositórios públicos. Um repositório privado requer um plano compatível, como GitHub Pro. Não foi contratado um plano pago. O titular autorizou e efetuou a alteração para público, confirmada pela API.

Tornar o repositório público expõe o código, a documentação e o histórico e exige uma decisão explícita do titular. Os valores dos segredos GitHub Actions não são incluídos nos ficheiros da exportação.

Fonte: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

## Construção

Com Node 24:

    npm run build:pages

A pasta out/ contém HTML, CSS, JavaScript, SVG e PNG locais, com caminhos adaptados a /time-saver/. As páginas legais têm diretórios próprios. São gerados favicon, imagem de partilha absoluta, URLs canónicos, política de referência e CSP por meta. Não são copiados segredos, código do Worker ou documentos internos.

O workflow github-pages.yml constrói um artefacto de revisão e verifica a configuração Pages. A produção só é publicada quando Pages está configurado e o preflight das páginas legais passa. O pedido posterior para colocar o site no ar é concretizado por um modo explícito de pré-lançamento: conserva a apresentação visual, remove todos os campos de recolha e substitui as minutas incompletas por informação sobre esta versão. Não ativa a recolha comercial nem publica dados legais inventados. Os marcadores das minutas continuam a bloquear o modo production.

O pré-lançamento público e a revisão ficam sem indexação. O modo preview é autorizado em config/domain.json e é selecionado por defeito; production exige a verificação legal. O formulário da versão completa permanece implementado no código, mas não integra o HTML público do pré-lançamento. Uma publicação que passa pelo preflight é construída com indexação preparada. O preflight é uma verificação de marcadores conhecidos e não comprova conformidade legal.

## Email e backend

GitHub Pages serve ficheiros estáticos e não executa o Worker. O formulário fica explicitamente desativado nesta exportação e não faz pedidos para endpoints inexistentes no domínio github.io.

O teste Resend em GitHub Actions já foi aceite pelo serviço e a receção no Gmail foi confirmada pelo titular. Esse teste não transforma Actions num backend público e o segredo não é disponibilizado ao navegador.

A ativação do formulário continua a exigir um backend adequado, a instalação do segredo no servidor, o remetente de produção e dados legais completos. O código já suporta um endpoint HTTPS configurável e CORS com origem exata, tokens, limites e idempotência. A variável QUOTE_API_ORIGIN só deve ser definida após instalar e validar esse backend.

## Limites de segurança e de utilização

GitHub Pages não disponibiliza a mesma configuração de cabeçalhos HTTP do Worker. A CSP por meta não suporta frame-ancestors e não substitui a configuração de X-Frame-Options ou HSTS. Confirmar os cabeçalhos efetivos antes do lançamento; não declarar que a variante Pages cumpre integralmente todos os requisitos de produção.

O GitHub documenta o registo dos IPs de visitantes para segurança. A Política de Privacidade deve refletir o alojamento efetivo, além do backend, serviço de envio e caixa de destino.

O GitHub também estabelece limitações ao uso de Pages como alojamento gratuito de negócios online e de sites principalmente orientados para facilitar transações comerciais. Dado o objetivo comercial da Time Saver, confirmar a adequação com o GitHub antes de adotar Pages como alojamento comercial definitivo. A ausência de pagamentos no website não comprova, por si só, que qualquer utilização seja elegível.

Fontes:

- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt
- https://help.openai.com/en/articles/20001494-connecting-and-managing-app-accounts-in-chatgpt
