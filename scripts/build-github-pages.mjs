import { readFile, writeFile, mkdir, readdir, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewHTML } from './preview-html.mjs';
import { contactHTML } from './contact-html.mjs';
import {readSiteSettings,applyContactLinks} from './site-settings.mjs';

const root = path.resolve(import.meta.dirname,'..');
const legalRoutes = new Set(['privacidade','aviso-legal','cookies']);
const pages={
  index:{route:'',language:'pt-PT',locale:'pt_PT',pair:'en',title:'Time Saver — Automatização em Excel, VBA e aplicações à medida',description:'Simplifique tarefas repetitivas com automatização em Excel, macros e VBA, dashboards, aplicações à medida e integrações. Descreva o processo e peça uma proposta.'},
  privacidade:{route:'privacidade/',language:'pt-PT',locale:'pt_PT',pair:'en-privacy',title:'Política de Privacidade — Time Saver',description:'Conheça os dados utilizados nos pedidos de orçamento, as finalidades, os fornecedores, a conservação e os direitos de privacidade na Time Saver.'},
  'aviso-legal':{route:'aviso-legal/',language:'pt-PT',locale:'pt_PT',pair:'en-legal',title:'Informações sobre o sítio — Time Saver',description:'Informação sobre os serviços Time Saver, a utilização do sítio, os pedidos de orçamento e os contactos relativos ao sítio.'},
  cookies:{route:'cookies/',language:'pt-PT',locale:'pt_PT',pair:'en-cookies',title:'Cookies e tecnologias locais — Time Saver',description:'Saiba como o sítio Time Saver utiliza tecnologias locais e recursos próprios, sem publicidade ou analítica instalada por defeito.'},
  en:{route:'en/',language:'en',locale:'en_GB',pair:'index',title:'Time Saver — Excel automation, VBA and custom applications',description:'Simplify repetitive work with Excel automation, macros and VBA, dashboards, custom applications and integrations. Describe your process and request a proposal.'},
  'en-privacy':{route:'en/privacy/',language:'en',locale:'en_GB',pair:'privacidade',title:'Privacy Policy — Time Saver',description:'Learn which data Time Saver uses for quote requests, why it is processed, the providers involved, retention and your privacy rights.'},
  'en-legal':{route:'en/legal/',language:'en',locale:'en_GB',pair:'aviso-legal',title:'Website information — Time Saver',description:'Information about Time Saver services, website use, quote requests and contacts for matters concerning the website.'},
  'en-cookies':{route:'en/cookies/',language:'en',locale:'en_GB',pair:'cookies',title:'Cookies and local technologies — Time Saver',description:'Find out how the Time Saver website uses local technologies and first-party resources, with no advertising or analytics installed by default.'}
};
const routeAliases=new Map(Object.entries(pages).flatMap(([name,page])=>[
  [name+'.html',page.route],[name,page.route],[page.route,page.route],
  ...(page.route?[[page.route.slice(0,-1),page.route],[page.route+'index.html',page.route]]:[])
]));
function escapeAttribute(value){return value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');}
function metadataText(value){return value.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&apos;',"'")
  .replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');}
function removeOwnedMetadata(html){
  return html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi,'')
    .replace(/<meta\b[^>]*>/gi,tag=> /\b(?:name|property)=["'](?:description|robots|referrer|time-saver-[^"']+|twitter:[^"']+|og:[^"']+)["']/i.test(tag)
      ||/\bhttp-equiv=["']Content-Security-Policy["']/i.test(tag)?'':tag)
    .replace(/<link\b[^>]*>/gi,tag=>/\brel=["'](?:canonical|alternate|icon)["']/i.test(tag)?'':tag);
}
function rewriteRootLinks(html,basePath){
  return html.replace(/\b(href|src)="\/(?!\/)([^"]*)"/g,(_match,attribute,target)=>{
    const suffixAt=target.search(/[?#]/),resource=suffixAt<0?target:target.slice(0,suffixAt),suffix=suffixAt<0?'':target.slice(suffixAt);
    return attribute+'="'+basePath+(routeAliases.get(resource)??resource)+suffix+'"';
  });
}
const csp = "default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; img-src 'self'; font-src 'self'; frame-src https://calendly.com; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'none'; require-trusted-types-for 'script'; trusted-types 'none'; upgrade-insecure-requests";

export async function buildGitHubPages({
  sourceDirectory = path.join(root,'public'),
  outputDirectory = path.join(root,'out'),
  basePath = '/time-saver/',
  origin = 'https://timesaverautomate.github.io',
  indexable = false,
  apiOrigin = '',
  publicPreview = false,
  publicContact = false,
  siteSettings
} = {}) {
  if(publicContact&&publicPreview)throw new Error('Modos de publicação incompatíveis.');
  if(publicContact){indexable=false;apiOrigin='';}
  if (publicPreview) { indexable=false; apiOrigin=''; }
  const settings=publicContact?(siteSettings??await readSiteSettings()):null;
  const canonicalOrigin=publicContact?settings.canonicalOrigin:origin;
  const canonicalBase=publicContact?'/':basePath;
  const canonicalSite=new URL(canonicalOrigin);
  if(canonicalSite.origin!==canonicalOrigin||canonicalSite.protocol!=='https:')throw new Error('Origem canónica HTTPS inválida.');
  if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(basePath) || basePath.split('/').some(part=>part === '.' || part === '..')) throw new Error('Caminho base inválido.');
  const siteOrigin = new URL(origin);
  if (siteOrigin.origin !== origin || siteOrigin.protocol !== 'https:') throw new Error('Origem HTTPS inválida.');
  if (apiOrigin) {
    const api = new URL(apiOrigin);
    if (api.origin !== apiOrigin || api.protocol !== 'https:') throw new Error('Origem do backend inválida.');
  }
  const policy = apiOrigin ? csp.replace("connect-src 'self'","connect-src 'self' "+apiOrigin) : csp;
  const sourcePath = path.resolve(sourceDirectory);
  const outputPath = path.resolve(outputDirectory);
  if (outputPath === sourcePath || outputPath.startsWith(sourcePath + path.sep) || sourcePath.startsWith(outputPath + path.sep) || outputPath === path.parse(outputPath).root) throw new Error('Diretório de saída inválido.');
  await rm(outputPath,{recursive:true,force:true});
  await mkdir(outputPath,{recursive:true});
  const files = await readdir(sourcePath,{withFileTypes:true});
  let count = 0;
  const publishedPages=[];
  for (const file of files) {
    if (!file.isFile() || !/\.(?:html|css|js|svg|png|txt)$/.test(file.name)) throw new Error('Recurso público não previsto: '+file.name);
    if (!file.name.endsWith('.html')) {
      await copyFile(path.join(sourcePath,file.name),path.join(outputPath,file.name));
      count++; continue;
    }
    let html = await readFile(path.join(sourcePath,file.name),'utf8');
    const name = file.name.slice(0,-5);
    // O modo histórico de pré-lançamento só publica a apresentação PT sem formulários.
    if(publicPreview&&pages[name]?.language==='en')continue;
    if (publicPreview) html=previewHTML(name,html);
    if (publicContact) html=contactHTML(name,html);
    if(publicContact)html=applyContactLinks(html,settings);
    const page=pages[name];
    const route=page?.route??(name==='index'?'':legalRoutes.has(name)?name+'/':file.name);
    const canonical=canonicalOrigin+canonicalBase+route;
    const sourceTitle=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const sourceDescription=html.match(/<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=(["'])(.*?)\1[^>]*>/i)?.[2];
    const title=metadataText(sourceTitle||page?.title||'Time Saver');
    const description=metadataText(sourceDescription||page?.description||'A página que procura não foi encontrada. Conheça os serviços de automatização da Time Saver.');
    const paired=page&&pages[page.pair];
    const pt=page?.language==='pt-PT'?page:paired;
    const en=page?.language==='en'?page:paired;
    html=rewriteRootLinks(removeOwnedMetadata(html),basePath);
    const shareImage=canonicalOrigin+canonicalBase+'partilha.png';
    const metadata = [
      '<title>'+escapeAttribute(title)+'</title>',
      '<meta name="description" content="'+escapeAttribute(description)+'">',
      '<meta http-equiv="Content-Security-Policy" content="'+policy+'">',
      '<meta name="referrer" content="strict-origin-when-cross-origin">',
      '<meta name="time-saver-form-mode" content="'+(apiOrigin ? 'backend' : 'disabled')+'">',
      '<meta name="time-saver-api-origin" content="'+apiOrigin+'">',
      ...(publicContact?['<meta name="time-saver-form-definition" content="direct-email-v1">']:[]),
      '<meta name="robots" content="'+(indexable&&name!=='404' ? 'index,follow' : 'noindex,nofollow')+'">',
      '<link rel="canonical" href="'+canonical+'">',
      ...(page?[
        '<link rel="alternate" hreflang="pt-PT" href="'+canonicalOrigin+canonicalBase+pt.route+'">',
        '<link rel="alternate" hreflang="en" href="'+canonicalOrigin+canonicalBase+en.route+'">',
        '<link rel="alternate" hreflang="x-default" href="'+canonicalOrigin+canonicalBase+pt.route+'">'
      ]:[]),
      '<meta property="og:type" content="website">',
      '<meta property="og:locale" content="'+(page?.locale||'pt_PT')+'">',
      ...(paired?['<meta property="og:locale:alternate" content="'+paired.locale+'">']:[]),
      '<meta property="og:title" content="'+escapeAttribute(title)+'">',
      '<meta property="og:description" content="'+escapeAttribute(description)+'">',
      '<meta property="og:url" content="'+canonical+'">',
      '<meta property="og:image" content="'+shareImage+'">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta property="og:image:alt" content="'+escapeAttribute(title)+'">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:title" content="'+escapeAttribute(title)+'">',
      '<meta name="twitter:description" content="'+escapeAttribute(description)+'">',
      '<meta name="twitter:image" content="'+shareImage+'">',
      '<link rel="icon" href="'+basePath+'favicon.svg" type="image/svg+xml">'
    ].join('\n');
    html = /<meta\s+charset=["']utf-8["']\s*\/?\s*>/i.test(html)
      ?html.replace(/(<meta\s+charset=["']utf-8["']\s*\/?\s*>)/i,'$1\n'+metadata)
      :html.replace(/(<head\b[^>]*>)/i,'$1\n<meta charset="utf-8">\n'+metadata);
    if(!publicContact){
      html = html.replace('A verificar a disponibilidade do formulário…','O formulário ainda não está disponível. O envio de pedidos está temporariamente desativado.');
      html = html.replace('Ative o JavaScript para validar e enviar este formulário. Os seus dados não foram enviados.','O envio de pedidos está temporariamente desativado.');
    }
    if (publicPreview && /\[[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ][^\]]+\]|<form\b/.test(html)) throw new Error('Pré-lançamento contém marcadores ou formulário.');
    if(publicContact&&/\[[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ][^\]]+\]/.test(html))throw new Error('Apresentação contém marcadores por preencher.');
    const destination=page?path.join(outputPath,page.route,'index.html'):path.join(outputPath,file.name);
    await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(destination,html);
    if(page)publishedPages.push({name,route,canonical});
    count++;
  }
  await writeFile(path.join(outputPath,'.nojekyll'),'');
  await writeFile(path.join(outputPath,'robots.txt'),'User-agent: *\n'+(indexable ? 'Allow: '+basePath : 'Disallow: /')+'\n');
  const sitemap='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    +publishedPages.map(page=>'  <url><loc>'+escapeAttribute(page.canonical)+'</loc></url>').join('\n')+'\n</urlset>\n';
  await writeFile(path.join(outputPath,'sitemap.xml'),sitemap);
  return {directory:outputPath,expectedURL:origin+basePath,resources:count,indexable,backendConfigured:Boolean(apiOrigin),publicPreview,publicContact,
    canonicalOrigin,sitemapPages:publishedPages.length,searchIndexingRequested:publicContact&&settings.searchIndexing===true,
    formAvailability:publicPreview ? 'Sem formulário nesta versão de pré-lançamento.' : 'Confirmada apenas pelo backend, nunca pela construção estática.'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const configuredBase = process.env.PAGES_BASE_PATH;
  const basePath = configuredBase === undefined ? '/time-saver/'
    : configuredBase === '' || configuredBase === '/' ? '/' : configuredBase.replace(/\/$/,'')+'/';
  const result = await buildGitHubPages({
    basePath,
    origin:process.env.PAGES_ORIGIN || 'https://timesaverautomate.github.io',
    indexable:process.env.PAGES_INDEXABLE === 'true',
    apiOrigin:process.env.PAGES_QUOTE_API_ORIGIN || '',
    publicPreview:process.env.PAGES_PUBLIC_PREVIEW === 'true',
    publicContact:process.env.PAGES_PUBLIC_CONTACT === 'true'
  });
  console.log(JSON.stringify(result,null,2));
}
