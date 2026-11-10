export const SERVICE_OPTIONS = ['Ainda não sei', 'Excel', 'VBA', 'Excel, macros e VBA', 'Automação de processos', 'Dashboards e relatórios', 'Tratamento de dados', 'Aplicação à medida', 'Integração entre ferramentas', 'Outro'];
export const GOAL_OPTIONS = ['A definir','Poupar tempo','Reduzir erros','Melhorar a informação de gestão','Ligar ferramentas','Organizar e acompanhar processos','Outro'];
export const FREQUENCY_OPTIONS = ['A definir','Várias vezes por dia','Diariamente','Semanalmente','Mensalmente','Pontualmente'];
export const STARTING_POINT_OPTIONS = ['A definir','Já existe um ficheiro ou processo','Melhorar uma solução existente','Criar de raiz'];
export const BUDGET_OPTIONS = ['A definir', 'Até 500 €', '500 € a 1 500 €', '1 500 € a 5 000 €', 'Mais de 5 000 €'];
export const DEADLINE_OPTIONS = ['A definir', 'Assim que possível', 'No próximo mês', 'Nos próximos 3 meses', 'Sem prazo definido'];
export const MAX_BODY = 16_384;
export function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value)
    && value.split('@')[0].length <= 64 && !value.startsWith('.') && !value.includes('.@')
    && value.split('@')[1].split('.').every(label => label.length <= 63)
    && !value.includes('..') && !/[\r\n\x00-\x20\x7f]/.test(value);
}
export function validateSubmission(input) {
  const errors = {};
  const data = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: { form: 'Pedido inválido.' }, data };
  const allowed = new Set(['name','email','description','company','service','tools','deadline','budget','website','token','goal','frequency','startingPoint','specifics']);
  if (Object.keys(input).some(key => !allowed.has(key))) errors.form = 'O pedido contém campos não permitidos.';
  const fields = { name: [2, 100], email: [3, 254], description: [30, 4000], company: [0, 160], tools: [0, 500], specifics:[0,500], website: [0, 200], token: [0, 600] };
  for (const [field, [min,max]] of Object.entries(fields)) {
    const raw = input[field] ?? '';
    if (typeof raw !== 'string') { errors[field] = 'Utilize texto neste campo.'; continue; }
    const value = raw.trim().normalize('NFC');
    data[field] = value;
    if (value.length < min || value.length > max) errors[field] = `Preencha entre ${min} e ${max} caracteres.`;
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) errors[field] = 'Remova os caracteres de controlo.';
    if (['name','email','company'].includes(field) && /[\r\n]/.test(value)) errors[field] = 'Utilize uma única linha.';
  }
  if (!validEmail(data.email)) errors.email = 'Indique um email válido, por exemplo nome@empresa.pt.';
  for (const [field, options] of [['service', SERVICE_OPTIONS], ['budget', BUDGET_OPTIONS], ['deadline', DEADLINE_OPTIONS],['goal',GOAL_OPTIONS],['frequency',FREQUENCY_OPTIONS],['startingPoint',STARTING_POINT_OPTIONS]]) {
    const value = input[field] ?? options[0];
    if (typeof value !== 'string' || !options.includes(value)) errors[field] = 'Selecione uma das opções disponíveis.';
    else data[field] = value;
  }
  return { data, errors };
}
export async function readBoundedJSON(request) {
  if (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity') throw new RangeError('encoding');
  const announced = request.headers.get('content-length');
  if (announced && (!/^\d+$/.test(announced) || Number(announced) > MAX_BODY)) throw new RangeError('size');
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('body');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new RangeError('size'); }
    chunks.push(value);
  }
  const all = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { all.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
}
