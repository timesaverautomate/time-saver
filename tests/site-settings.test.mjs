import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarPublicURL,whatsappPublicURL,applyContactLinks} from '../scripts/site-settings.mjs';
import {validateSubmission} from '../src/validation.mjs';

test('ligações de agenda requerem HTTPS público e rejeitam gestão, credenciais e origens semelhantes',()=>{
  assert.equal(calendarPublicURL('https://calendly.com/timesaverautomate/30min'),'https://calendly.com/timesaverautomate/30min');
  assert.equal(calendarPublicURL('[LINK_CALENDARIO]'),'');
  for(const url of ['https://calendly.com/app/scheduling/meeting_types/user/me',
    'http://calendly.com/team/call','javascript:alert(1)','https://calendly.com.evil.example/team/call',
    'https://user:pass@calendly.com/team/call','https://cal.com/auth/sign-in',
    'https://cal.com/team/call?access_token=not-a-real-token']){
    assert.throws(()=>calendarPublicURL(url),/calendar_public_url_invalid/);
  }
});

test('WhatsApp é omitido quando não configurado e só aceita número internacional sem espaços',()=>{
  assert.equal(whatsappPublicURL('[NUMERO_WHATSAPP]'),'');
  for(const value of ['+351912345678','351 912 345 678','00351912345678','351<script>']){
    assert.throws(()=>whatsappPublicURL(value),/whatsapp_number_invalid/);
  }
  const url=new URL(whatsappPublicURL('351912345678'));
  assert.equal(url.origin,'https://wa.me');assert.equal(url.pathname,'/351912345678');
  assert.equal(url.searchParams.get('text'),'Olá, gostaria de saber mais sobre automatização de processos');
  assert.match(new URL(whatsappPublicURL('351912345678',true)).searchParams.get('text'),/process automation/);
});

test('calendário publicado abre com proteção de separador e não apresenta botões WhatsApp inativos',()=>{
  for(const lang of ['pt-PT','en']){
    const html=`<html lang="${lang}"><button type="button" class="button" data-contact="calendar" disabled>20 min</button><button type="button" data-contact="whatsapp" disabled>WhatsApp</button><p data-contact-note="calendar">Pendente</p><p data-contact-note="whatsapp">Pendente</p></html>`;
    const result=applyContactLinks(html,{calendarUrl:'https://calendly.com/timesaverautomate/30min',whatsappNumber:'[NUMERO_WHATSAPP]'});
    assert.match(result,/<a[^>]*href="https:\/\/calendly.com\/timesaverautomate\/30min"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    assert.doesNotMatch(result,/WhatsApp|Pendente|20 min|disabled/);
    assert.ok(result.includes(lang==='en'?'Book a free call':'Marcar conversa gratuita'));
  }
});

test('descrição mínima autorizada é 10 caracteres e email continua obrigatório',()=>{
  const input={name:'Teste',email:'teste@example.com',description:'0123456789'};
  assert.deepEqual(validateSubmission(input).errors,{});
  assert.ok(validateSubmission({...input,description:'012345678'}).errors.description);
  assert.ok(validateSubmission({...input,description:' \n\t '}).errors.description);
  assert.ok(validateSubmission({...input,email:''}).errors.email);
});
