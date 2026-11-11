const contact = 'timesaverautomate@gmail.com';
const legalContent = {
  privacidade: {
    title:'Privacidade no pré-lançamento',
    body:`<p>Esta versão apresenta a Time Saver e exemplos ilustrativos de automatização. Não disponibiliza um formulário nem recebe pedidos de orçamento.</p>
<h2>Contacto de privacidade</h2><p>Para assuntos de proteção de dados relativos a este website, contacte ${contact}. Não envie dados sensíveis ou informação confidencial.</p>
<h2>Funcionamento desta versão</h2><p>O código do site não inclui publicidade, pixels de marketing, analítica, contas de utilizador ou armazenamento persistente no navegador. Não são enviados dados de formulários para um serviço de email.</p>
<p>Os ficheiros das páginas são alojados no GitHub Pages. No domínio timesaverautomate.com, a Cloudflare assegura a entrega e proteção através de um Worker que consulta essa origem por HTTPS. Estas infraestruturas podem tratar metadados técnicos de acesso, incluindo o endereço IP, para disponibilização e segurança do serviço. Consulte a <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" rel="noreferrer">Política de Privacidade do GitHub</a> para conhecer os tratamentos desse fornecedor. Consulte também a <a href="https://www.cloudflare.com/privacypolicy/" rel="noreferrer">Política de Privacidade da Cloudflare</a>.</p>
<h2>Direitos e atualização</h2><p>Pode utilizar o contacto acima para questões ou pedidos relativos aos seus dados. Pode também reclamar à <a href="https://www.cnpd.pt/" rel="noreferrer">Comissão Nacional de Proteção de Dados</a>. A identificação completa do prestador e a informação sobre o tratamento dos pedidos serão disponibilizadas antes da ativação comercial.</p>`
  },
  'aviso-legal': {
    title:'Sobre este pré-lançamento',
    body:`<p>Time Saver é a marca apresentada neste website de pré-lançamento. O conteúdo permite conhecer os serviços previstos e exemplos ilustrativos de automatização.</p>
<p>Esta versão não disponibiliza pedidos de orçamento, contratação, pagamentos ou contas de utilizador. Os exemplos não representam projetos concluídos, clientes ou garantias de resultados.</p>
<h2>Contacto legal e de privacidade</h2><p>${contact}. Este contacto destina-se a questões relativas ao website; o fluxo comercial de orçamento ainda não está disponível.</p>
<h2>Antes da abertura comercial</h2><p>A identificação legal completa e as informações aplicáveis à atividade serão disponibilizadas antes de receber pedidos comerciais. O website encontra-se em pré-lançamento.</p>`
  },
  cookies: {
    title:'Cookies e tecnologias nesta versão',
    body:`<p>O código desta versão não cria cookies, não usa armazenamento persistente no navegador e não inclui publicidade, analítica ou pixels de marketing. Não existe formulário para preencher.</p>
<p>Os ficheiros são alojados no GitHub Pages; no domínio próprio, a Cloudflare intervém na entrega e proteção. Estas infraestruturas podem tratar metadados técnicos de acesso. O inventário de tecnologias deve ser revisto se forem ativados desafios no navegador ou outras funcionalidades da plataforma. Consulte também a <a href="/privacidade">informação de privacidade</a>.</p>
<p>Não foi acrescentado um banner de consentimento decorativo. A introdução futura de ferramentas ou de serviços no navegador exige nova avaliação das tecnologias efetivamente utilizadas e, quando aplicável, a obtenção de consentimento antes da sua utilização.</p>`
  }
};

export function previewHTML(name, html) {
  if (legalContent[name]) {
    const {title,body}=legalContent[name];
    return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} — Time Saver</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"></head><body><a class="skip-link" href="#conteudo">Saltar para o conteúdo</a><header class="site-header"><div class="container header-inner"><a class="brand" href="/" aria-label="Time Saver — início"><img src="/logo.svg" width="218" height="42" alt="Time Saver"></a><a class="button button-small" href="/#orcamento">Pré-lançamento</a></div></header><main id="conteudo" class="legal-main"><div class="container legal-container"><a href="/">← Voltar ao início</a><h1>${title}</h1><p class="legal-meta">TIME SAVER · PRÉ-LANÇAMENTO</p>${body}</div></main><footer class="site-footer"><div class="container footer-bottom"><span>Time Saver · Pré-lançamento</span><nav aria-label="Informações do website"><a href="/privacidade">Privacidade</a><a href="/aviso-legal">Sobre esta versão</a><a href="/cookies">Cookies</a></nav></div></footer></body></html>`;
  }
  if (name!=='index') return html;
  // Os passos são secções aninhadas: remover sempre a secção exterior completa.
  const start=html.search(/<section class="quote section" id="orcamento"(?=\s|>)/);
  if(start<0)throw new Error('Secção de orçamento não encontrada; pré-lançamento bloqueado.');
  const tags=html.slice(start).matchAll(/<\/?section\b[^>]*>/g);
  let depth=0,end=-1;
  for(const tag of tags){
    depth+=tag[0].startsWith('</')?-1:1;
    if(depth===0){end=start+tag.index+tag[0].length;break;}
  }
  if(end<0)throw new Error('Secção de orçamento incompleta; pré-lançamento bloqueado.');
  const quoteSection=html.slice(start,end);
  html=html.replace(quoteSection,`<section class="quote section" id="orcamento" aria-labelledby="quote-title"><div class="container quote-grid"><div class="quote-intro"><p class="eyebrow dark"><span class="section-number">05 /</span> PRÉ-LANÇAMENTO</p><h2 id="quote-title">Estamos a preparar<br>o próximo <span class="serif-accent">passo.</span></h2><p>Já pode conhecer a Time Saver e explorar exemplos do que é possível automatizar. O pedido de orçamento ficará disponível aqui após concluirmos a preparação do serviço.</p></div><div class="prelaunch-card"><span class="small-ring" aria-hidden="true">↗</span><h3>Mais tempo. Menos tarefas.</h3><p>O formulário ainda não está disponível. Esta versão não recebe pedidos nem recolhe dados através de formulários.</p><a class="text-link" href="#servicos">Explorar os serviços <span aria-hidden="true">↗</span></a></div></div></section>`);
  html=html.replace('<main id="conteudo">','<main id="conteudo"><div class="preview-banner"><div class="container">Time Saver · Pré-lançamento <span>O pedido de orçamento ainda não está disponível.</span></div></div>');
  html=html.replaceAll('Pedir orçamento','Ver pré-lançamento')
    .replace('Peça um orçamento.','Conheça a versão de pré-lançamento.')
    .replace('Vamos conversar sobre o seu processo','Conhecer o pré-lançamento')
    .replace('O primeiro passo é seu. O próximo, damos juntos.','Conheça o próximo passo da Time Saver.')
    .replace('Versão de revisão · identificação legal por completar. Contacto comercial através do formulário de orçamento.','Versão de pré-lançamento · pedidos de orçamento ainda indisponíveis.');
  if (/<(?:form|input|textarea|select)\b/i.test(html)) throw new Error('Pré-lançamento não pode incluir campos de recolha.');
  return html;
}
