import { readFile, writeFile, mkdir, readdir, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewHTML } from './preview-html.mjs';

const root = path.resolve(import.meta.dirname,'..');
const legalRoutes = new Set(['privacidade','aviso-legal','cookies']);
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; upgrade-insecure-requests";

export async function buildGitHubPages({
  sourceDirectory = path.join(root,'public'),
  outputDirectory = path.join(root,'out'),
  basePath = '/time-saver/',
  origin = 'https://timesaverautomate.github.io',
  indexable = false,
  apiOrigin = '',
  publicPreview = false
} = {}) {
  if (publicPreview) { indexable=false; apiOrigin=''; }
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
  for (const file of files) {
    if (!file.isFile() || !/\.(?:html|css|js|svg|png|txt)$/.test(file.name)) throw new Error('Recurso público não previsto: '+file.name);
    if (!file.name.endsWith('.html')) {
      await copyFile(path.join(sourcePath,file.name),path.join(outputPath,file.name));
      count++; continue;
    }
    let html = await readFile(path.join(sourcePath,file.name),'utf8');
    const name = file.name.slice(0,-5);
    if (publicPreview) html=previewHTML(name,html);
    const route = name === 'index' ? '' : legalRoutes.has(name) ? name+'/' : file.name;
    const canonical = origin+basePath+route;
    html = html.replace(/\b(href|src)="\/(?!\/)([^"]*)"/g,(_match,attribute,target)=>{
      const hashPosition = target.indexOf('#');
      const resource = hashPosition < 0 ? target : target.slice(0,hashPosition);
      const hash = hashPosition < 0 ? '' : target.slice(hashPosition);
      const mapped = legalRoutes.has(resource) ? resource+'/' : resource === 'index.html' ? '' : resource;
      return attribute+'="'+basePath+mapped+hash+'"';
    });
    html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, '$1'+origin+basePath+'partilha.png$2');
    const metadata = [
      '<meta http-equiv="Content-Security-Policy" content="'+policy+'">',
      '<meta name="referrer" content="strict-origin-when-cross-origin">',
      '<meta name="time-saver-form-mode" content="'+(apiOrigin ? 'backend' : 'disabled')+'">',
      '<meta name="time-saver-api-origin" content="'+apiOrigin+'">',
      '<meta name="robots" content="'+(indexable ? 'index,follow' : 'noindex,nofollow')+'">',
      '<link rel="canonical" href="'+canonical+'">',
      '<meta property="og:url" content="'+canonical+'">'
    ].join('\n');
    html = html.replace(/(<meta charset="utf-8">)/,'$1\n'+metadata);
    html = html.replace('A verificar a disponibilidade do formulário…','O formulário ainda não está disponível. O envio de pedidos está temporariamente desativado.');
    html = html.replace('Ative o JavaScript para validar e enviar este formulário. Os seus dados não foram enviados.','O envio de pedidos está temporariamente desativado.');
    if (publicPreview && /\[[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ][^\]]+\]|<form\b/.test(html)) throw new Error('Pré-lançamento contém marcadores ou formulário.');
    const destination = legalRoutes.has(name) ? path.join(outputPath,name,'index.html') : path.join(outputPath,file.name);
    await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(destination,html);
    count++;
  }
  await writeFile(path.join(outputPath,'.nojekyll'),'');
  await writeFile(path.join(outputPath,'robots.txt'),'User-agent: *\n'+(indexable ? 'Allow: '+basePath : 'Disallow: /')+'\n');
  return {directory:outputPath,expectedURL:origin+basePath,resources:count,indexable,backendConfigured:Boolean(apiOrigin),publicPreview,formAvailability:publicPreview ? 'Sem formulário nesta versão de pré-lançamento.' : 'Confirmada apenas pelo backend, nunca pela construção estática.'};
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
    publicPreview:process.env.PAGES_PUBLIC_PREVIEW === 'true'
  });
  console.log(JSON.stringify(result,null,2));
}
