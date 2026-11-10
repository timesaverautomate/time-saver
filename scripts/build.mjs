import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'..');
await mkdir(path.join(root,'dist/server'),{recursive:true});
await mkdir(path.join(root,'dist/.openai'),{recursive:true});
const assets = {};
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.png':'image/png'};
for (const file of await readdir(path.join(root,'public'))) {
  const ext = path.extname(file);
  if (!types[ext]) throw new Error(`Formato não previsto: ${file}`);
  const route = file === 'index.html' ? '/' : ext === '.html' ? `/${path.basename(file,ext)}` : `/${file}`;
  const bytes = await readFile(path.join(root,'public',file));
  assets[route] = {type:types[ext],body:bytes.toString(ext === '.png' ? 'base64' : 'utf8'),encoding:ext === '.png' ? 'base64' : 'utf8'};
}
const parts = [`// Construção determinística Time Saver. Não editar este ficheiro.\nconst ASSETS = ${JSON.stringify(assets)};`];
for (const file of ['validation.mjs','security.mjs','store.mjs','mail.mjs','worker.mjs']) {
  let source = await readFile(path.join(root,'src',file),'utf8');
  source = source.replace(/^import .*?;\n/gm,'').replace(/^export (?=(?:const|async|function))/gm,'');
  parts.push(`\n// ${file}\n${source}`);
}
await writeFile(path.join(root,'dist/server/index.js'),parts.join('\n'));
await writeFile(path.join(root,'dist/.openai/hosting.json'),await readFile(path.join(root,'.openai/hosting.json')));
console.log(`Worker criado: ${Object.keys(assets).length} recursos locais, ${Buffer.byteLength(parts.join('\n'))} bytes, sem dependências de produção.`);
