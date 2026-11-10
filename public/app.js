'use strict';
const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navegacao');
function closeMenu() {
  menuButton?.setAttribute('aria-expanded','false');
  navigation?.classList.remove('is-open');
}
menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded',String(open));
  navigation.classList.toggle('is-open',open);
});
navigation?.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
document.addEventListener('keydown',event=>{
  if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
    closeMenu(); menuButton.focus();
  }
});
document.addEventListener('click',event=>{
  if (menuButton?.getAttribute('aria-expanded') === 'true' && !event.target.closest('.site-header')) closeMenu();
});
const currentYear = document.querySelector('#current-year');
if (currentYear) currentYear.textContent = String(new Date().getFullYear());

const flows = {
  relatorios:['Vários ficheiros Excel','Informação espalhada, trabalho repetido.','Ligar. Organizar. Automatizar.','Um relatório organizado','Dados reunidos. Informação pronta a consultar.','Exemplo: reunir vários ficheiros Excel num relatório organizado.'],
  integracoes:['Informação em várias ferramentas','O mesmo dado introduzido mais do que uma vez.','Validar. Ligar. Sincronizar.','Ferramentas em sintonia','Uma ligação definida entre ferramentas compatíveis.','Exemplo: integrar ferramentas compatíveis para reduzir a introdução repetida de dados.'],
  pedidos:['Pedidos recebidos pela equipa','Tarefas e estados em locais diferentes.','Reunir. Organizar. Acompanhar.','Um processo acompanhado','Pedidos organizados, com um estado definido.','Exemplo: organizar pedidos internos numa aplicação à medida.']
};
const flowButtons = Array.from(document.querySelectorAll('[data-flow]'));
function selectFlow(button,focus=false) {
  const values = flows[button.dataset.flow];
  if (!values) return;
  flowButtons.forEach(tab=>{
    const selected = tab === button;
    tab.setAttribute('aria-selected',String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  ['flow-source','flow-source-note','flow-action','flow-result','flow-result-note','flow-caption'].forEach((id,index)=>{
    document.getElementById(id).textContent = values[index];
  });
  document.querySelector('#flow-caption').setAttribute('aria-labelledby',button.id);
  if (focus) button.focus();
}
flowButtons.forEach((button,index)=>{
  button.addEventListener('click',()=>selectFlow(button));
  button.addEventListener('keydown',event=>{
    let next = index;
    if (event.key === 'ArrowRight') next = (index+1)%flowButtons.length;
    else if (event.key === 'ArrowLeft') next = (index+flowButtons.length-1)%flowButtons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = flowButtons.length-1;
    else return;
    event.preventDefault(); selectFlow(flowButtons[next],true);
  });
});

const form = document.querySelector('#quote-form');
if (form) {
  const configuredAPI = document.querySelector('meta[name="time-saver-api-origin"]')?.content || '';
  let apiBase = '', invalidAPI = false;
  if (configuredAPI) {
    try {
      const parsed = new URL(configuredAPI);
      if (parsed.origin !== configuredAPI || parsed.protocol !== 'https:') invalidAPI = true;
      else apiBase = parsed.origin;
    } catch { invalidAPI = true; }
  }
  const formDisabledByHosting = invalidAPI || document.querySelector('meta[name="time-saver-form-mode"]')?.content === 'disabled';
  const submit = form.querySelector('[type=submit]');
  const submitLabel = submit.querySelector('span');
  const availability = document.querySelector('#form-availability');
  const result = document.querySelector('#form-result');
  const description = form.elements.description;
  let token = '', available = false, busy = false, sent = false;
  let submissionKey = '', lastSignature = '';
  let tokenReadyTimer;
  const originalLabel = submitLabel.textContent;
  const limits = {name:[2,100],email:[3,254],description:[30,4000],company:[0,160],tools:[0,500]};
  const labels = {name:'Nome',email:'Email de contacto',description:'Descrição do processo',company:'Empresa',tools:'Ferramentas',service:'Tipo de serviço',budget:'Orçamento',deadline:'Prazo'};
  function updateCounter() {
    document.querySelector('#description-count').textContent = description.value.length.toLocaleString('pt-PT') + ' / 4 000';
  }
  description.addEventListener('input',updateCounter);
  function setFieldError(name,message) {
    const input = form.elements[name];
    const error = document.getElementById(name+'-error');
    if (!input || !error) return;
    input.setAttribute('aria-invalid',String(Boolean(message)));
    error.textContent = message || '';
    if (message && input.closest('.optional-details')) input.closest('.optional-details').open = true;
  }
  Object.keys(labels).forEach(name=>{
    form.elements[name]?.addEventListener('input',()=>setFieldError(name,''));
    form.elements[name]?.addEventListener('change',()=>setFieldError(name,''));
  });
  function showMessage(message,success=false) {
    result.replaceChildren();
    result.dataset.success = String(success);
    result.setAttribute('role',success ? 'status' : 'alert');
    const p = document.createElement('p');
    p.textContent = message; p.className = 'result-text';
    result.append(p); result.focus();
  }
  function showErrors(errors) {
    Object.keys(labels).forEach(name=>setFieldError(name,errors[name]));
    showMessage('Há campos que precisam da sua atenção. Os dados que preencheu foram mantidos.');
    const list = document.createElement('ul');
    for (const [name,message] of Object.entries(errors)) {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      if (form.elements[name]) {
        anchor.href = '#'+name;
        anchor.textContent = (labels[name] || name)+': '+message;
        anchor.addEventListener('click',event=>{event.preventDefault();form.elements[name].focus();});
        item.append(anchor);
      } else item.textContent = message;
      list.append(item);
    }
    result.append(list);
  }
  async function refreshToken() {
    available = false; submit.disabled = true;
    clearTimeout(tokenReadyTimer);
    if (formDisabledByHosting) {
      availability.hidden = false;
      availability.textContent = 'O formulário ainda não está disponível. O envio de pedidos está temporariamente desativado.';
      return;
    }
    try {
      const response = await fetch(apiBase+'/api/form-status',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12_000)});
      const status = await response.json();
      if (!response.ok || !status.available || typeof status.token !== 'string') throw new Error(status.message || 'O formulário está temporariamente indisponível.');
      token = status.token;
      availability.hidden = true;
      // A proteção temporal do servidor não deve impedir uma nova tentativa imediata.
      tokenReadyTimer = setTimeout(()=>{available=true;submit.disabled=busy || sent;},1600);
    } catch (error) {
      token = '';
      availability.hidden = false;
      availability.textContent = error.name === 'TimeoutError' || error.name === 'TypeError'
        ? 'Não foi possível verificar o serviço. Recarregue a página para voltar a tentar.'
        : error.message;
    }
  }
  function collect() {
    const data = {};
    ['name','email','description','company','service','tools','deadline','budget','website'].forEach(name=>{data[name]=form.elements[name].value.trim().normalize('NFC');});
    return data;
  }
  function validate(data) {
    const errors = {};
    for (const [name,[min,max]] of Object.entries(limits)) {
      if (data[name].length < min || data[name].length > max) errors[name] = 'Preencha entre '+min+' e '+max+' caracteres.';
    }
    if (!form.elements.email.validity.valid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'Indique um email válido, por exemplo nome@empresa.pt.';
    return errors;
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if (busy || sent) return;
    if (!available) { showMessage('O formulário ainda não está disponível. O pedido não foi enviado.'); return; }
    const data = collect();
    const errors = validate(data);
    if (Object.keys(errors).length) { showErrors(errors); return; }
    Object.keys(labels).forEach(name=>setFieldError(name,''));
    const signature = JSON.stringify(data);
    if (signature !== lastSignature || !submissionKey) {
      submissionKey = crypto.randomUUID(); lastSignature = signature;
    }
    busy = true; submit.disabled = true;
    form.setAttribute('aria-busy','true'); submitLabel.textContent = 'A enviar o pedido…';
    result.replaceChildren();
    try {
      const response = await fetch(apiBase+'/api/quote',{
        method:'POST', credentials:'omit', cache:'no-store',
        headers:{'Content-Type':'application/json','Idempotency-Key':submissionKey},
        body:JSON.stringify({...data,token}),signal:AbortSignal.timeout(20_000)
      });
      const payload = await response.json();
      if (response.ok && payload.accepted === true && payload.reference) {
        sent = true;
        showMessage('O seu pedido foi aceite para envio. Referência: '+payload.reference+'. Esta confirmação indica aceitação pelo serviço de email; não confirma a entrega na caixa de entrada.',true);
        submitLabel.textContent = 'Pedido aceite para envio';
      } else if (payload.errors) showErrors(payload.errors);
      else {
        showMessage(payload.message || 'Não foi possível confirmar o envio. Os dados foram mantidos; tente novamente.');
        if (payload.renewKey) submissionKey = '';
        if (payload.refreshToken) await refreshToken();
      }
    } catch {
      showMessage('Não foi possível confirmar o envio. Os dados foram mantidos. Verifique a ligação e tente novamente com os mesmos dados para evitar duplicados.');
    } finally {
      busy = false; form.setAttribute('aria-busy','false');
      submit.disabled = !available || sent;
      if (!sent) submitLabel.textContent = originalLabel;
    }
  });
  refreshToken();
}
