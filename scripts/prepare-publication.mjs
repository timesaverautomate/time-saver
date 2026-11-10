import { readFile, appendFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const config=JSON.parse(await readFile(new URL('../config/domain.json',import.meta.url),'utf8'));
const mode=process.env.REQUESTED_PUBLICATION || config.publicationMode;
if (!['preview','contact','production'].includes(mode)) throw new Error('Modo de publicação inválido.');
if (mode==='preview' && config.publicPreviewAuthorised!==true) throw new Error('Pré-lançamento não autorizado na configuração.');
if(mode==='contact'&&!(config.directEmailFormAuthorised===true&&config.emailProviderRetentionAccepted===true))throw new Error('Envio direto ainda não configurado.');
if (mode==='production') {
  const checked=spawnSync(process.execPath,['scripts/preflight.mjs'],{stdio:'inherit'});
  if (checked.status!==0) process.exit(1);
}
const output='preview='+String(mode==='preview')+'\ncontact='+String(mode==='contact')+'\nindexable='+String(mode==='production')+'\n';
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,output);
console.log(mode==='preview' ? 'Publicar pré-lançamento sem formulário, sem marcadores legais e sem indexação.'
  : mode==='contact'?'Publicar formulário de envio direto por email, sem base de dados. A identificação jurídica não foi validada.'
  : 'Verificação de marcadores legais aprovada; continuar validação operacional.');
