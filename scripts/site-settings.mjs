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
  return result;
}
