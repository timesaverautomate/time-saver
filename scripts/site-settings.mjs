import {readFile} from 'node:fs/promises';

const ORIGIN='https://timesaverautomate.com';
const CALENDAR_HOSTS=new Set(['calendly.com','www.calendly.com','cal.com','www.cal.com']);
const missing=value=>!value||/^\[[A-Z_]+\]$/.test(value);
const escapeAttribute=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;')
  .replaceAll("'",'&#39;').replaceAll('<','&lt;').replaceAll('>','&gt;');

export function calendarPublicURL(value){
  if(missing(value))return '';
  if(typeof value!=='string')throw Error('calendar_public_url_invalid');
  let url;
  try{url=new URL(value);}catch{throw Error('calendar_public_url_invalid');}
  if(url.protocol!=='https:'||!CALENDAR_HOSTS.has(url.hostname)||url.username||url.password
    ||url.port||!url.pathname.slice(1)||/^\/(?:app|auth|login|sign_in|oauth)(?:\/|$)/i.test(url.pathname)
    ||[...url.searchParams.keys()].some(key=>/^(?:access_token|token|code|auth|email|name)$/i.test(key))){
    throw Error('calendar_public_url_invalid');
  }
  url.hash='';
  return url.href;
}

export function whatsappPublicURL(value,english=false){
  if(missing(value))return '';
  if(typeof value!=='string'||!/^[1-9]\d{7,14}$/.test(value))throw Error('whatsapp_number_invalid');
  const message=english?"Hello, I'd like to learn more about process automation."
    :'Olá, gostaria de saber mais sobre automatização de processos';
  return 'https://wa.me/'+value+'?text='+encodeURIComponent(message);
}

export async function readSiteSettings(){
  const value=JSON.parse(await readFile(new URL('../config/site.json',import.meta.url),'utf8'));
  if(value.canonicalOrigin!==ORIGIN||typeof value.searchIndexing!=='boolean')throw Error('site_settings_invalid');
  calendarPublicURL(value.calendarUrl);whatsappPublicURL(value.whatsappNumber);
  return value;
}

function bookingDialog(english,url){
  const t=(pt,en)=>english?en:pt;
  return `<dialog id="booking-dialog" class="booking-dialog" aria-labelledby="booking-title" aria-describedby="booking-description">
  <div class="booking-shell">
    <div class="booking-topbar"><img src="/logo.svg" width="218" height="42" alt="Time Saver"><button type="button" class="booking-close" data-booking-close autofocus aria-label="${t('Fechar agenda','Close booking calendar')}"><span aria-hidden="true">×</span></button></div>
    <div class="booking-layout">
      <aside class="booking-intro">
        <p class="eyebrow booking-eyebrow">${t('O primeiro passo para simplificar','Your first step towards simpler work')}</p>
        <h2 id="booking-title">${t('Vamos dar tempo<br>ao seu negócio.','Make more time<br>for your business.')}</h2>
        <p id="booking-description">${t('Conte-nos o que ocupa tempo à sua equipa. Vamos perceber, em conjunto, o que pode ser automatizado.','Tell us what takes up your team’s time. Together, we’ll explore what you could automate.')}</p>
        <div class="booking-facts"><span>${t('30 minutos','30 minutes')}</span><span>${t('Conversa gratuita','Free introductory call')}</span></div>
        <ol class="booking-steps"><li>${t('Escolha o dia e a hora.','Choose a date and time.')}</li><li>${t('Indique os seus contactos.','Enter your contact details.')}</li><li>${t('Confirme a marcação na agenda.','Confirm your booking in the calendar.')}</li></ol>
        <p class="booking-privacy">${t('Não precisa de enviar ficheiros nem informação confidencial. A agenda é disponibilizada pelo Calendly, com as suas próprias escolhas de cookies e privacidade.','No files or confidential information needed. The calendar is provided by Calendly, with its own cookie and privacy choices.')} <a href="https://calendly.com/privacy" target="_blank" rel="noopener noreferrer">${t('Privacidade do Calendly','Calendly privacy')}</a></p>
      </aside>
      <section class="booking-calendar" aria-labelledby="booking-calendar-title">
        <div class="booking-calendar-heading"><span class="booking-indicator" aria-hidden="true"></span><h3 id="booking-calendar-title">${t('Escolha o melhor momento para si','Find a time that works for you')}</h3></div>
        <p id="booking-status" class="booking-status" role="status"></p>
        <div id="booking-frame" class="booking-frame"></div>
        <div class="booking-help"><p>${t('A agenda não aparece ou prefere outro separador?','Calendar not showing, or prefer a separate tab?')}</p><a id="booking-fallback" href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer">${t('Abrir no Calendly','Open in Calendly')} <span aria-hidden="true">↗</span></a></div>
      </section>
    </div>
  </div>
</dialog>`;
}

export function applyContactLinks(html,settings){
  const english=/<html\b[^>]*\blang=["']en(?:["'-])/i.test(html);
  const urls={calendar:calendarPublicURL(settings.calendarUrl),whatsapp:whatsappPublicURL(settings.whatsappNumber,english)};
  let result=html.replace(/<button\b([^>]*\bdata-contact="(calendar|whatsapp)"[^>]*)>([\s\S]*?)<\/button>/g,
    (_match,attributes,kind,content)=>{
      const icon=content.match(/<svg\b[\s\S]*?<\/svg>/)?.[0]||'';
      const label=kind==='calendar'?(english?'Book a free call':'Marcar conversa gratuita'):'WhatsApp';
      if(!urls[kind])return kind==='whatsapp'?'':`<button${attributes} aria-disabled="true">${label}${icon?' '+icon:''}</button>`;
      const clean=attributes.replace(/\s+type="button"/g,'').replace(/\s+disabled(?:="[^"]*")?/g,'')
        .replace(/\s+aria-disabled="[^"]*"/g,'');
      return `<a${clean} href="${escapeAttribute(urls[kind])}" target="_blank" rel="noopener noreferrer">${label}${icon?' '+icon:''}</a>`;
    });
  result=result.replace(/<(p|span)\b([^>]*\bdata-contact-note="(calendar|whatsapp)"[^>]*)>[\s\S]*?<\/\1>/g,
    (_match,tag,attributes,kind)=>urls[kind]||kind==='whatsapp'?'':`<${tag}${attributes}>${english?'Booking link coming soon.':'Ligação da agenda por configurar.'}</${tag}>`);
  // Só páginas com uma ligação de agenda recebem a janela. O calendário remoto
  // não tem src no HTML e só é criado pelo código local após o clique.
  if(urls.calendar&&new URL(urls.calendar).hostname==='calendly.com'
    &&/<a\b[^>]*\bdata-contact="calendar"/.test(result)){
    result=result.replace('</body>',bookingDialog(english,urls.calendar)+'\n</body>');
  }
  return result;
}
