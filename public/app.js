'use strict';
const isEN = document.documentElement.lang.startsWith('en');
const locale = isEN ? 'en-GB' : 'pt-PT';
const translate = (pt,en) => isEN ? en : pt;
const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navegacao');
function setMenuLabel(open) {
  const label=menuButton?.querySelector('.sr-only');
  if(label)label.textContent=open ? translate('Fechar menu','Close menu') : translate('Abrir menu','Open menu');
}
function closeMenu() {
  menuButton?.setAttribute('aria-expanded','false');
  navigation?.classList.remove('is-open');
  setMenuLabel(false);
}
menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded',String(open));
  navigation?.classList.toggle('is-open',open);
  setMenuLabel(open);
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

// A agenda externa só é carregada após um pedido explícito do visitante.
const bookingDialog = document.querySelector('#booking-dialog');
const bookingFrame = document.querySelector('#booking-frame');
const bookingStatus = document.querySelector('#booking-status');
const bookingFallback = document.querySelector('#booking-fallback');
if (bookingDialog && bookingFrame && bookingStatus && bookingFallback
    && typeof bookingDialog.showModal === 'function') {
  let bookingTrigger = null;
  let bookingLoadingTimer;
  bookingDialog.querySelector('[data-booking-close]')?.addEventListener('click',()=>bookingDialog.close());
  bookingDialog.addEventListener('click',event=>{
    if(event.target!==bookingDialog)return;
    const bounds=bookingDialog.getBoundingClientRect();
    if(event.clientX<bounds.left || event.clientX>bounds.right
        || event.clientY<bounds.top || event.clientY>bounds.bottom)bookingDialog.close();
  });
  bookingDialog.addEventListener('close',()=>{
    clearTimeout(bookingLoadingTimer);
    bookingFrame.replaceChildren();
    bookingFrame.classList.remove('is-loading');
    bookingFrame.removeAttribute('aria-busy');
    bookingStatus.textContent='';
    document.documentElement.classList.remove('booking-open');
    if(bookingTrigger?.isConnected)bookingTrigger.focus({preventScroll:true});
    bookingTrigger=null;
  });
  document.querySelectorAll('a[data-contact="calendar"]').forEach(link=>{
    link.addEventListener('click',event=>{
      if(event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey
          || event.shiftKey || event.altKey || bookingDialog.open)return;
      let calendar;
      try {
        calendar=new URL(link.href);
        if(calendar.origin!=='https://calendly.com'
            || calendar.pathname!=='/timesaverautomate/30min'
            || calendar.username || calendar.password || calendar.search || calendar.hash)return;
        // Sem JavaScript ou sem diálogo nativo, a ligação original continua a funcionar.
        bookingDialog.showModal();
      } catch {return;}
      event.preventDefault();
      bookingTrigger=link;
      document.documentElement.classList.add('booking-open');
      bookingFallback.href=calendar.href;
      calendar.search=new URLSearchParams({
        embed_domain:location.hostname,
        embed_type:'Inline',
        hide_event_type_details:'1',
        background_color:'f8fcfa',
        text_color:'18332f',
        primary_color:'146451'
      }).toString();
      const iframe=document.createElement('iframe');
      iframe.title=translate('Calendário para marcar uma conversa com a Time Saver','Calendar for booking a call with Time Saver');
      iframe.referrerPolicy='no-referrer';
      iframe.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
      iframe.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'");
      bookingStatus.textContent=translate('A carregar os horários disponíveis…','Loading available times…');
      bookingFrame.classList.add('is-loading');
      bookingFrame.setAttribute('aria-busy','true');
      iframe.addEventListener('load',()=>{
        if(!bookingDialog.open || !iframe.isConnected)return;
        clearTimeout(bookingLoadingTimer);
        bookingFrame.classList.remove('is-loading');
        bookingFrame.removeAttribute('aria-busy');
        bookingStatus.textContent=translate('Escolha o dia e o horário na agenda.','Choose a date and time in the calendar.');
      },{once:true});
      iframe.src=calendar.href;
      bookingFrame.replaceChildren(iframe);
      bookingLoadingTimer=setTimeout(()=>{
        if(bookingDialog.open)bookingStatus.textContent=translate(
          'Se o calendário não aparecer, utilize a ligação abaixo para abrir a agenda.',
          'If the calendar does not appear, use the link below to open it.');
      },12000);
    });
  });
}

const flows = {
  relatorios:[
    translate('Vários ficheiros Excel','Several Excel files'),
    translate('Informação espalhada, trabalho repetido.','Scattered information, repeated work.'),
    translate('Ligar. Organizar. Automatizar.','Connect. Organise. Automate.'),
    translate('Um relatório organizado','One organised report'),
    translate('Dados reunidos. Informação pronta a consultar.','Data brought together. Information ready to review.'),
    translate('Exemplo: reunir vários ficheiros Excel num relatório organizado.','Example: combine several Excel files into one organised report.')
  ],
  integracoes:[
    translate('Informação em várias ferramentas','Information across several tools'),
    translate('O mesmo dado introduzido mais do que uma vez.','The same data entered more than once.'),
    translate('Validar. Ligar. Sincronizar.','Validate. Connect. Synchronise.'),
    translate('Ferramentas em sintonia','Tools working together'),
    translate('Uma ligação definida entre ferramentas compatíveis.','A defined connection between compatible tools.'),
    translate('Exemplo: integrar ferramentas compatíveis para reduzir a introdução repetida de dados.','Example: integrate compatible tools to reduce repeated data entry.')
  ],
  pedidos:[
    translate('Pedidos recebidos pela equipa','Requests received by the team'),
    translate('Tarefas e estados em locais diferentes.','Tasks and statuses in different places.'),
    translate('Reunir. Organizar. Acompanhar.','Collect. Organise. Track.'),
    translate('Um processo acompanhado','A process you can follow'),
    translate('Pedidos organizados, com um estado definido.','Requests organised, each with a defined status.'),
    translate('Exemplo: organizar pedidos internos numa aplicação à medida.','Example: organise internal requests in a custom application.')
  ]
};
const flowButtons = Array.from(document.querySelectorAll('[data-flow]'));
function selectFlow(button,focus=false) {
  if(!Object.hasOwn(flows,button.dataset.flow))return;
  const values=flows[button.dataset.flow];
  const targets=['flow-source','flow-source-note','flow-action','flow-result','flow-result-note','flow-caption'].map(id=>document.getElementById(id));
  if(targets.some(target=>!target))return;
  flowButtons.forEach(tab=>{
    const selected=tab===button;
    tab.setAttribute('aria-selected',String(selected));
    tab.tabIndex=selected?0:-1;
  });
  targets.forEach((target,index)=>{target.textContent=values[index];});
  targets[5].setAttribute('aria-labelledby',button.id);
  if(focus)button.focus();
}
flowButtons.forEach((button,index)=>{
  button.addEventListener('click',()=>selectFlow(button));
  button.addEventListener('keydown',event=>{
    let next=index;
    if(event.key==='ArrowRight')next=(index+1)%flowButtons.length;
    else if(event.key==='ArrowLeft')next=(index+flowButtons.length-1)%flowButtons.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=flowButtons.length-1;
    else return;
    event.preventDefault();selectFlow(flowButtons[next],true);
  });
});
const initialFlow=flowButtons.find(button=>button.getAttribute('aria-selected')==='true')||flowButtons[0];
if(initialFlow)selectFlow(initialFlow);

const form = document.querySelector('#quote-form');
if (form) {
  const copy={
    unavailable:translate('O formulário está temporariamente indisponível.','The form is temporarily unavailable.'),
    hostingDisabled:translate('O formulário ainda não está disponível. O envio de pedidos está temporariamente desativado.','The form is not available yet. Request submission is temporarily disabled.'),
    checking:translate('A verificar a disponibilidade do formulário…','Checking form availability…'),
    checkFailed:translate('Não foi possível verificar o serviço. Os campos foram mantidos; volte a verificar quando a ligação estiver disponível.',"We couldn't check the service. Your entries have been kept; check again when your connection is available."),
    checkRestored:translate('O serviço está novamente disponível e os campos foram mantidos. Verifique os dados e carregue em Enviar pedido de orçamento. O envio não foi repetido automaticamente.','The service is available again and your entries have been kept. Check your details and select Send quote request. Your request has not been resubmitted automatically.'),
    needsAttention:translate('Há campos que precisam da sua atenção. Os dados que preencheu foram mantidos.','Some fields need your attention. Your entries have been kept.'),
    notSent:translate('O formulário ainda não está disponível. O pedido não foi enviado.','The form is not available yet. Your request has not been sent.'),
    sending:translate('A enviar o pedido…','Sending your request…'),
    received:translate('Recebemos o seu pedido. Respondemos em 24–48h úteis.',"We've received your request. We'll reply within 24–48 business hours."),
    reference:translate('Referência: ','Reference: '),
    emailAcceptance:translate('Esta confirmação indica aceitação pelo serviço de email; não confirma a entrega na caixa de entrada.','This confirms acceptance by the email service; it does not confirm delivery to the inbox.'),
    accepted:translate('Pedido aceite para envio','Request accepted for sending'),
    sendFailed:translate('Não foi possível confirmar o envio. Os dados foram mantidos; tente novamente.',"We couldn't confirm submission. Your entries have been kept; please try again."),
    connectionFailed:translate('Não foi possível confirmar o envio. Os dados foram mantidos. Verifique a ligação e tente novamente com os mesmos dados para evitar duplicados.',"We couldn't confirm submission. Your entries have been kept. Check your connection and try again with the same details to avoid duplicates."),
    renewed:translate('A sessão foi renovada e os campos foram mantidos. Verifique os dados e volte a carregar em Enviar pedido de orçamento. O envio não foi repetido automaticamente.','Your session has been renewed and your entries have been kept. Check your details and select Send quote request again. Your request has not been resubmitted automatically.'),
    fieldFallback:translate('Verifique este campo e tente novamente.','Please check this field and try again.'),
    emailInvalid:translate('Indique um email válido, por exemplo nome@empresa.pt.','Enter a valid email address, for example name@company.com.')
  };
  const serverMessages = new Map([
    ['Página não encontrada.','Page not found.'],
    ['Método não permitido.','This request method is not allowed.'],
    ['Não foi possível validar a origem do pedido.',"We couldn't verify the origin of your request."],
    ['O envio está temporariamente indisponível. Tente novamente mais tarde.','Submission is temporarily unavailable. Please try again later.'],
    ['O formulário está temporariamente indisponível.',copy.unavailable],
    ['Aguarde um minuto e volte a tentar.','Wait one minute and try again.'],
    ['Foram feitas demasiadas tentativas. Aguarde um minuto antes de tentar novamente.','There have been too many attempts. Wait one minute before trying again.'],
    ['Formato de pedido inválido.','The request format is invalid.'],
    ['Reabra o formulário e tente novamente.','Reopen the form and try again.'],
    ['A transmissão demorou demasiado. Os campos foram mantidos; verifique a ligação e tente novamente.','Submission took too long. Your entries have been kept; check your connection and try again.'],
    ['O pedido excede o tamanho permitido.','Your request exceeds the permitted size.'],
    ['Não foi possível ler o pedido.',"We couldn't read your request. Please try again."],
    ['Verifique os campos assinalados.','Please check the highlighted fields.'],
    ['Não foi possível validar o pedido. Reabra o formulário.',"We couldn't validate your request. Reopen the form and try again."],
    ['A sessão do formulário precisa de ser renovada. Os campos foram mantidos. Aguarde a renovação e confirme novamente o envio.','Your form session needs to be renewed. Your entries have been kept. Wait for renewal, then confirm submission again.'],
    ['Não foi possível registar o pedido neste momento. Os campos foram mantidos; tente novamente.',"We couldn't record your request right now. Your entries have been kept; please try again."],
    ['O pedido está a ser processado ou foi alterado. Aguarde um momento e tente novamente com os mesmos dados.','Your request is being processed or has changed. Wait a moment and try again with the same details.'],
    ['Não foi possível confirmar o envio. Os campos foram mantidos; aguarde um momento e tente novamente.',"We couldn't confirm submission. Your entries have been kept; wait a moment and try again."],
    ['O serviço está temporariamente indisponível. Os campos foram mantidos; tente novamente mais tarde.','The service is temporarily unavailable. Your entries have been kept; please try again later.'],
    ['Pedido inválido.','Your request is invalid.'],
    ['O pedido contém campos não permitidos.','Your request contains unsupported fields.'],
    ['Utilize texto neste campo.','Enter text in this field.'],
    ['Remova os caracteres de controlo.','Remove control characters from this field.'],
    ['Utilize uma única linha.','Use a single line in this field.'],
    ['Indique um email válido, por exemplo nome@empresa.pt.',copy.emailInvalid],
    ['Selecione uma das opções disponíveis.','Choose one of the available options.']
  ]);
  function serverMessage(message,fallback=copy.sendFailed) {
    if(typeof message!=='string')return fallback;
    if(!isEN)return message;
    if(serverMessages.has(message))return serverMessages.get(message);
    const length=message.match(/^Preencha entre (\d+) e (\d+) caracteres\.$/);
    if(length)return 'Enter between '+Number(length[1]).toLocaleString(locale)+' and '+Number(length[2]).toLocaleString(locale)+' characters.';
    return fallback;
  }
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
  const retryAvailability = document.querySelector('#retry-availability');
  const result = document.querySelector('#form-result');
  const description = form.elements.description;
  let token = '', available = false, busy = false, sent = false;
  let checkingAvailability = false, sessionRefreshNeeded = false;
  let submissionKey = '', lastSignature = '';
  let tokenReadyTimer;
  const originalLabel = submitLabel.textContent;
  const editableFields=Array.from(form.querySelectorAll('input,textarea,select'));
  const limits = {name:[2,100],email:[3,254],description:[description.minLength>0?description.minLength:30,description.maxLength>0?description.maxLength:4000],company:[0,160],tools:[0,500],specifics:[0,500]};
  const labels = isEN
    ? {name:'Name',email:'Contact email',description:'Process description',company:'Company',tools:'Tools',service:'Type of help',budget:'Budget',deadline:'Preferred deadline',goal:'Main goal',frequency:'Frequency',startingPoint:'Starting point',specifics:'Details'}
    : {name:'Nome',email:'Email de contacto',description:'Descrição do processo',company:'Empresa',tools:'Ferramentas',service:'Tipo de ajuda',budget:'Orçamento',deadline:'Prazo',goal:'Objetivo',frequency:'Frequência',startingPoint:'Ponto de partida',specifics:'Detalhes'};
  const context = isEN ? {
    'Excel, macros e VBA':['Tell us which files you use, what you do manually and what you would like to automate.','For example: every month we combine several Excel files and repeat the same calculations and formatting. We would like to prepare everything in one step.','Are there any important rules or calculations?'],
    'Automação de processos':['Describe the steps, who is involved and where work is repeated.','For example: we copy requests received by email into a spreadsheet, then notify the team. We would like to reduce these manual steps.','Which steps are currently done manually?'],
    'Dashboards e relatórios':['Tell us where your data comes from, which indicators you need and how often you review them.','For example: we would like to combine sales and expenses in a dashboard based on our existing files, without rebuilding the report every month.','Which indicators would you like to track?'],
    'Tratamento de dados':['Explain where your information is stored and what you need to combine, correct or organise.','For example: we have lists in several files, with different formats and duplicate records. We need organised data to work with.','What problems are there with your data?'],
    'Integração entre ferramentas':['Tell us which tools you use and what information needs to move between them.','For example: requests arrive in one tool and are copied into another. We would like to avoid entering the same information twice.','What information needs to move between tools?'],
    'Aplicação à medida':['Describe the process the application should support and the main things people need to do.','For example: we need an internal tool to record requests, track their status and view information in one place.','What should people be able to do in the application?'],
    'Ainda não sei':['Tell us what you do today, what takes time and what you would like to improve.','For example: every month we repeat several steps to prepare information for the team. We would like to simplify the process and reduce errors.','Is there anything else that would help us understand what you need?']
  } : {
    'Excel, macros e VBA':['Que ficheiros utiliza, o que faz manualmente e o que gostaria de automatizar?','Por exemplo: juntamos vários ficheiros Excel todos os meses e repetimos cálculos e formatações. Queremos preparar tudo num único passo.','Há regras ou cálculos importantes?'],
    'Automação de processos':['Descreva os passos da tarefa, quem intervém e onde costuma haver repetição.','Por exemplo: copiamos pedidos recebidos por email para uma folha e depois enviamos avisos à equipa. Queremos reduzir estes passos manuais.','Que passos são hoje feitos manualmente?'],
    'Dashboards e relatórios':['Diga de onde vêm os dados, que indicadores precisa de acompanhar e com que frequência.','Por exemplo: queremos reunir vendas e despesas num painel atualizado a partir dos ficheiros existentes, sem refazer o relatório todos os meses.','Que indicadores quer acompanhar?'],
    'Tratamento de dados':['Explique onde está a informação e o que precisa de reunir, corrigir ou organizar.','Por exemplo: temos listas em vários ficheiros, com formatos diferentes e registos repetidos. Queremos uma base organizada para trabalhar.','Que problemas existem nos dados?'],
    'Integração entre ferramentas':['Indique as ferramentas e a informação que precisa de passar entre elas.','Por exemplo: os pedidos entram numa ferramenta e são copiados para outra. Gostaríamos de evitar introduzir os mesmos dados duas vezes.','Que informação deve passar de uma ferramenta para outra?'],
    'Aplicação à medida':['Descreva o processo que a aplicação deve apoiar e as principais ações dos utilizadores.','Por exemplo: queremos uma ferramenta interna para registar pedidos, acompanhar estados e consultar a informação num único local.','O que deve ser possível fazer na aplicação?'],
    'Ainda não sei':['Conte-nos o que faz hoje, o que está a dar trabalho e o que gostaria de melhorar.','Por exemplo: todos os meses repetimos vários passos para preparar informação para a equipa. Gostaríamos de simplificar o processo e reduzir erros.','Há algum detalhe que ajude a perceber a necessidade?']
  };
  const fieldNodes = name => Array.from(form.querySelectorAll('[name="'+name+'"]'));
  function focusField(name) {
    const fields=fieldNodes(name); (fields.find(field=>field.checked)||fields[0])?.focus();
  }
  function updateServiceContext() {
    const values=context[form.elements.service?.value]||context['Ainda não sei'];
    const guidance=document.querySelector('#service-guidance');
    if(guidance)guidance.textContent=values[0];
    description.placeholder=values[1];
    const label=document.querySelector('#specifics-label');if(label)label.textContent=values[2];
  }
  fieldNodes('service').forEach(field=>field.addEventListener('change',updateServiceContext));
  updateServiceContext();
  function updateCounter() {
    const counter=document.querySelector('#description-count');
    if(counter)counter.textContent = description.value.length.toLocaleString(locale) + ' / '+limits.description[1].toLocaleString(locale);
  }
  description.addEventListener('input',updateCounter);
  updateCounter();
  function setFieldError(name,message) {
    const inputs = fieldNodes(name);
    const error = document.getElementById(name+'-error');
    if (!inputs.length || !error) return;
    inputs.forEach(input=>input.setAttribute('aria-invalid',String(Boolean(message))));
    error.textContent = message || '';
    if (message && inputs[0].closest('.optional-details')) inputs[0].closest('.optional-details').open = true;
  }
  Object.keys(labels).forEach(name=>{
    fieldNodes(name).forEach(input=>{
      input.addEventListener('input',()=>setFieldError(name,''));
      input.addEventListener('change',()=>setFieldError(name,''));
    });
  });
  function showMessage(message,success=false) {
    result.replaceChildren();
    result.dataset.success = String(success);
    result.setAttribute('role',success ? 'status' : 'alert');
    const p = document.createElement('p');
    p.textContent = message; p.className = 'result-text';
    result.append(p); result.focus();
  }
  function showErrors(errors,localized=false) {
    const translated=Object.fromEntries(Object.entries(errors).map(([name,message])=>[name,localized?message:serverMessage(message,copy.fieldFallback)]));
    Object.keys(labels).forEach(name=>setFieldError(name,translated[name]));
    showMessage(copy.needsAttention);
    const list = document.createElement('ul');
    for (const [name,message] of Object.entries(translated)) {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      if (Object.hasOwn(labels,name) && form.elements[name]) {
        anchor.href = '#'+(fieldNodes(name)[0]?.id||name);
        anchor.textContent = labels[name]+': '+message;
        anchor.addEventListener('click',event=>{event.preventDefault();focusField(name);});
        item.append(anchor);
      } else item.textContent = message;
      list.append(item);
    }
    result.append(list);
  }
  async function refreshToken() {
    if(checkingAvailability)return false;
    checkingAvailability=true;
    available = false; submit.disabled = true;
    clearTimeout(tokenReadyTimer);
    if(retryAvailability)retryAvailability.disabled=true;
    try {
      availability.hidden=false;
      if (formDisabledByHosting) {
        availability.textContent = copy.hostingDisabled;
        if(retryAvailability)retryAvailability.hidden=true;
        return false;
      }
      availability.textContent=copy.checking;
      const response = await fetch(apiBase+'/api/form-status',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12_000)});
      const status = await response.json();
      if (!response.ok || !status.available || typeof status.token !== 'string') throw new Error(status.message || copy.unavailable);
      token = status.token;
      if(sessionRefreshNeeded){submissionKey='';lastSignature='';sessionRefreshNeeded=false;}
      availability.hidden = true;
      if(retryAvailability)retryAvailability.hidden=true;
      tokenReadyTimer = setTimeout(()=>{available=true;submit.disabled=busy || sent;},1600);
      return true;
    } catch (error) {
      token = '';
      availability.hidden = false;
      availability.textContent = ['TimeoutError','TypeError','SyntaxError','AbortError'].includes(error.name)
        ? copy.checkFailed
        : serverMessage(error.message,copy.unavailable);
      if(retryAvailability)retryAvailability.hidden=false;
      return false;
    } finally {
      checkingAvailability=false;
      if(retryAvailability)retryAvailability.disabled=busy || sent;
    }
  }
  retryAvailability?.addEventListener('click',async()=>{
    if(busy || sent || checkingAvailability || formDisabledByHosting)return;
    if(await refreshToken())showMessage(copy.checkRestored);
  });
  function collect() {
    const data = {};
    const defaults={service:'Ainda não sei',deadline:'A definir',budget:'A definir',goal:'A definir',frequency:'A definir',startingPoint:'A definir'};
    // A leitura opcional da política não é consentimento nem faz parte do pedido enviado.
    ['name','email','description','company','service','tools','deadline','budget','website','goal','frequency','startingPoint','specifics'].forEach(name=>{data[name]=(form.elements[name]?.value||defaults[name]||'').trim().normalize('NFC');});
    return data;
  }
  function validate(data) {
    const errors = {};
    for (const [name,[min,max]] of Object.entries(limits)) {
      if (data[name].length < min || data[name].length > max) errors[name] = translate('Preencha entre '+min+' e '+max+' caracteres.','Enter between '+min.toLocaleString(locale)+' and '+max.toLocaleString(locale)+' characters.');
    }
    if (!form.elements.email.validity.valid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = copy.emailInvalid;
    return errors;
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if (busy || sent) return;
    if (!available) { showMessage(copy.notSent); return; }
    const data = collect();
    const errors = validate(data);
    if (Object.keys(errors).length) { showErrors(errors,true); return; }
    Object.keys(labels).forEach(name=>setFieldError(name,''));
    const signature = JSON.stringify(data);
    if (signature !== lastSignature || !submissionKey) {
      submissionKey = crypto.randomUUID(); lastSignature = signature;
    }
    busy = true; submit.disabled = true;
    if(retryAvailability)retryAvailability.disabled=true;
    editableFields.forEach(field=>{field.disabled=true;});
    form.setAttribute('aria-busy','true'); submitLabel.textContent = copy.sending;
    result.replaceChildren();
    try {
      const response = await fetch(apiBase+'/api/quote',{
        method:'POST', credentials:'omit', cache:'no-store',
        headers:{'Content-Type':'application/json','Idempotency-Key':submissionKey},
        body:JSON.stringify({...data,token}),signal:AbortSignal.timeout(25_000)
      });
      const payload = await response.json();
      if (response.ok && payload.accepted === true && payload.reference) {
        sent = true;
        showMessage(copy.received+' '+copy.reference+payload.reference+'. '+copy.emailAcceptance,true);
        submitLabel.textContent = copy.accepted;
        form.reset();updateCounter();updateServiceContext();
        lastSignature='';submissionKey='';token='';
        if(retryAvailability)retryAvailability.hidden=true;
        const another=document.querySelector('#new-request');if(another)another.hidden=false;
      } else if (payload.errors) showErrors(payload.errors);
      else {
        showMessage(serverMessage(payload.message,copy.sendFailed));
        if (payload.renewKey) submissionKey = '';
        if (payload.refreshToken) {
          sessionRefreshNeeded=true;
          await refreshToken();
          if(token)showMessage(copy.renewed);
        }
      }
    } catch {
      showMessage(copy.connectionFailed);
    } finally {
      busy = false; form.setAttribute('aria-busy','false');
      editableFields.forEach(field=>{field.disabled=false;});
      submit.disabled = !available || sent;
      if(retryAvailability)retryAvailability.disabled=checkingAvailability || sent;
      if (!sent) submitLabel.textContent = originalLabel;
    }
  });
  document.querySelector('#new-request')?.addEventListener('click',async()=>{
    if(busy || checkingAvailability)return;
    sent=false;submissionKey='';lastSignature='';token='';result.replaceChildren();
    sessionRefreshNeeded=false;
    document.querySelector('#new-request').hidden=true;submitLabel.textContent=originalLabel;
    await refreshToken();focusField('service');
  });
  refreshToken();
}
