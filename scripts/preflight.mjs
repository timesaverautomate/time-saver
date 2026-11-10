import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'..');
const pending = [];
for (const file of await readdir(path.join(root,'public'))) {
  if (!file.endsWith('.html')) continue;
  const html = await readFile(path.join(root,'public',file),'utf8');
  if (/\[[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ][^\]]+\]/.test(html)) pending.push(file+': contém dados legais por preencher');
  if (/Documento em preparação|identificação legal por completar|Preparação para publicação|ainda tem de ser verificado/.test(html)) pending.push(file+': contém indicação de revisão pendente');
}
if (pending.length) {
  console.error('Publicação comercial bloqueada:\n'+pending.map(x=>' - '+x).join('\n'));
  console.error('Siga docs/ENTREGA.md e docs/PRIVACIDADE-E-OPERACAO.md antes de publicar.');
  process.exitCode = 1;
} else console.log('Não foram encontrados marcadores conhecidos nas páginas públicas. A revisão jurídica e a validação operacional continuam a ser necessárias.');
