import { readFile, appendFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const config=JSON.parse(await readFile(new URL('../config/domain.json',import.meta.url),'utf8'));
const mode=process.env.REQUESTED_PUBLICATION || config.publicationMode;
if (!['preview','production'].includes(mode)) throw new Error('Modo de publicação inválido.');
if (mode==='preview' && config.publicPreviewAuthorised!==true) throw new Error('Pré-lançamento não autorizado na configuração.');
if (mode==='production') {
  const checked=spawnSync(process.execPath,['scripts/preflight.mjs'],{stdio:'inherit'});
  if (checked.status!==0) process.exit(1);
}
const output='preview='+String(mode==='preview')+'\nindexable='+String(mode==='production')+'\n';
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,output);
console.log(mode==='preview' ? 'Publicar pré-lançamento sem formulário, sem marcadores legais e sem indexação.'
  : 'Verificação de marcadores legais aprovada; continuar validação operacional.');
