import test from 'node:test';
import assert from 'node:assert/strict';
import webhook, { verifySvix, verifySvixDetailed, readWebhookBody, WebhookBodyError } from '../workers/resend-webhook.js';

const NOW = 1794384000000;
const SECRET = 'whsec_' + btoa('synthetic-webhook-key-for-tests!!');
const encoder = new TextEncoder();
const URL = 'https://webhook.example.invalid/webhooks/resend';
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

async function signedHeaders(body, { now = NOW, id = 'msg_synthetic_test', secret = SECRET } = {}) {
  const timestamp = String(Math.floor(now / 1000));
  const bytes = Uint8Array.from(atob(secret.slice(6)), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${timestamp}.${body}`)));
  const signature = btoa(String.fromCharCode(...digest));
  return new Headers({ 'content-type': 'application/json', 'svix-id': id,
    'svix-timestamp': timestamp, 'svix-signature': 'v1,' + signature });
}
async function requestFor(body, options = {}) {
  return new Request(URL, { method: 'POST', headers: await signedHeaders(body, options), body });
}

test('assinatura UTF-8 produzida pelo SDK oficial Svix é compatível', async () => {
  // Vetor sintético gerado com svix Python 1.99.1; não é uma credencial real.
  const body = '{"type":"email.delivered","data":{"email_id":"ficticio-123","nota":"Olá, automação!"}}';
  const headers = new Headers({ 'svix-id': 'msg_sdk_compatibility', 'svix-timestamp': String(NOW / 1000),
    'svix-signature': 'v1,Rh/ljPXFoxFmKNWm2YPzNUiATWqHiTSlO3CBKbpWJ3k=' });
  assert.equal(await verifySvix(body, headers, SECRET, NOW), true);
  assert.equal(await verifySvix(body.replace('Olá', 'Outro texto'), headers, SECRET, NOW), false);
});

test('limites anunciados e codificação são recusados antes de abrir o corpo', async () => {
  for (const [headers, expected] of [[{ 'content-length': '65537' }, 413],
    [{ 'content-length': '-1' }, 413], [{ 'content-length': 'invalid' }, 413],
    [{ 'content-length': '9'.repeat(100) }, 413], [{ 'content-encoding': 'gzip' }, 415]]) {
    let reads = 0;
    const request = { url: URL, method: 'POST', headers: new Headers(headers),
      body: { getReader() { reads++; throw Error('must_not_open_reader'); } } };
    const response = await webhook.fetch(request, {});
    assert.equal(response.status, expected); assert.equal(reads, 0);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('fragmento ou fluxo excessivo sem Content-Length termina com 413 e cancela sem aguardar', async t => {
  t.mock.method(Date, 'now', () => NOW);
  for (const chunks of [[new Uint8Array(65537)], [new Uint8Array(32768), new Uint8Array(32769)]]) {
    let index = 0, cancelled = 0, released = 0;
    const headers = await signedHeaders('{}');
    const request = { url: URL, method: 'POST', headers, body: { getReader: () => ({
      read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
      cancel: () => { cancelled++; return new Promise(() => {}); },
      releaseLock: () => { released++; }
    }) } };
    const response = await webhook.fetch(request, { RESEND_WEBHOOK_SECRET: SECRET });
    assert.equal(response.status, 413); assert.deepEqual(await response.json(), { error: 'too_large' });
    assert.equal(cancelled, 1); assert.equal(released, 1); assert.equal(index, chunks.length);
  }
});

test('deadline total não reinicia com fragmentos e cancelamento bloqueado não prende a rejeição', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let completeRead, reads = 0, cancelled = 0, released = 0, result;
  const reader = {
    read() { reads++; return new Promise(resolve => { completeRead = resolve; }); },
    cancel() { cancelled++; return new Promise(() => {}); },
    releaseLock() { released++; }
  };
  const pending = readWebhookBody({ headers: new Headers(), body: { getReader: () => reader } }, { timeoutMs: 5 })
    .then(value => { result = value; }, error => { result = error; });
  await flush(); t.mock.timers.tick(4);
  completeRead({ done: false, value: encoder.encode('{') }); await flush();
  assert.equal(reads, 2); t.mock.timers.tick(1); await flush();
  assert.ok(result instanceof WebhookBodyError); assert.equal(result.status, 408);
  assert.equal(result.message, 'body_timeout'); assert.equal(cancelled, 1); assert.equal(released, 1);
  await pending;
});

test('UTF-8 inválido é recusado e JSON inválido assinado não causa erro interno', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const bad = new Request(URL, { method: 'POST', headers: await signedHeaders('{}'), body: new Uint8Array([0xc3, 0x28]) });
  const response = await webhook.fetch(bad, { RESEND_WEBHOOK_SECRET: SECRET });
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'invalid_body' });
  const invalidJSON = await webhook.fetch(await requestFor('{'), { RESEND_WEBHOOK_SECRET: SECRET });
  assert.equal(invalidJSON.status, 400); assert.deepEqual(await invalidJSON.json(), { error: 'invalid_json' });
});

test('assinatura e segredo malformados falham fechados sem ler o corpo ou divulgar detalhes', async t => {
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(console, 'warn', () => {});
  for (const secret of [undefined, null, 42, {}, '', 'whsec_', 'whsec_test', 'whsec_' + 'A'.repeat(300)]) {
    let reads = 0;
    const request = { url: URL, method: 'POST', headers: await signedHeaders('{}'),
      body: { getReader() { reads++; throw Error('private_internal_details'); } } };
    const response = await webhook.fetch(request, { RESEND_WEBHOOK_SECRET: secret });
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'unauthorized' });
    assert.equal(reads, 0);
    assert.equal(await verifySvix('{}', request.headers, secret, NOW), false);
  }
  const valid = await signedHeaders('{}');
  for (const [name, value] of [['svix-id', 'x'.repeat(201)], ['svix-timestamp', '1'.repeat(100)],
    ['svix-timestamp', String(NOW / 1000 - 301)], ['svix-timestamp', String(NOW / 1000 + 301)],
    ['svix-signature', 'x'.repeat(1025)]]) {
    const headers = new Headers(valid); headers.set(name, value);
    assert.equal(await verifySvix('{}', headers, SECRET, NOW), false);
  }
});

test('diagnóstico detalhado preserva categorias seguras e entradas limitadas sem devolver material assinado', async () => {
  const headers = await signedHeaders('{}');
  const changed = (name, value) => { const copy = new Headers(headers); copy.set(name, value); return copy; };
  const cases = [
    ['{}', new Headers(), SECRET, 'missing_headers'],
    ['{}', headers, {}, 'secret_missing_or_invalid_format'],
    ['{}', headers, 'whsec_%%%%', 'invalid_secret_encoding'],
    ['{}', changed('svix-timestamp', 'x'.repeat(10000)), SECRET, 'invalid_timestamp'],
    ['{}', changed('svix-timestamp', String(NOW / 1000 - 301)), SECRET, 'timestamp_outside_5_min_window'],
    ['{}', changed('svix-id', 'x'.repeat(201)), SECRET, 'invalid_header_format'],
    ['{}', changed('svix-signature', 'x'.repeat(1025)), SECRET, 'invalid_signature_format'],
    ['{}', { get() { throw Error('private_internal_error'); } }, SECRET, 'missing_headers'],
    ['x'.repeat(65537), headers, SECRET, 'signature_mismatch'],
    ['changed body', headers, SECRET, 'signature_mismatch']
  ];
  for (const [body, inputHeaders, secret, reason] of cases) {
    const result = await verifySvixDetailed(body, inputHeaders, secret, NOW);
    assert.deepEqual(result, { valid: false, reason });
    assert.deepEqual(Object.keys(result).sort(), ['reason', 'valid']);
  }
  assert.deepEqual(await verifySvixDetailed('{}', headers, SECRET, NOW), { valid: true, reason: 'verified' });
});

test('diagnóstico do proprietário mantém console.warn apenas com categoria anónima', async t => {
  t.mock.method(Date, 'now', () => NOW); const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const headers = await signedHeaders('{}', { id: 'msg_private_header_token' });
  const privateBody = '{"private_body_token":"never_log_this"}';
  const missing = await webhook.fetch(new Request(URL, { method: 'POST', body: '{}' }), { RESEND_WEBHOOK_SECRET: SECRET });
  const unconfigured = await webhook.fetch(new Request(URL, { method: 'POST', headers, body: '{}' }), {});
  const mismatch = await webhook.fetch(new Request(URL, { method: 'POST', headers, body: privateBody }), { RESEND_WEBHOOK_SECRET: SECRET });
  assert.equal(missing.status, 401); assert.equal(unconfigured.status, 401); assert.equal(mismatch.status, 401);
  assert.deepEqual(warnings, [
    ['resend_webhook_verification_failed', 'missing_headers'],
    ['resend_webhook_verification_failed', 'secret_missing_or_invalid_format'],
    ['resend_webhook_verification_failed', 'signature_mismatch']
  ]);
  const logged = JSON.stringify(warnings);
  for (const value of [SECRET, privateBody, headers.get('svix-id'), headers.get('svix-signature'), headers.get('svix-timestamp')]) {
    assert.equal(logged.includes(value), false);
  }
});

test('conteúdo adulterado, assinatura falsa e assinatura de evento expirado são rejeitados', async t => {
  t.mock.method(Date, 'now', () => NOW);
  const headers = await signedHeaders('{}');
  assert.equal(await verifySvix('{"changed":true}', headers, SECRET, NOW), false);
  const falseHeaders = new Headers(headers); falseHeaders.set('svix-signature', 'v1,' + btoa('x'.repeat(32)));
  assert.equal(await verifySvix('{}', falseHeaders, SECRET, NOW), false);
  assert.equal(await verifySvix('{}', headers, SECRET, NOW + 300000), true);
  assert.equal(await verifySvix('{}', headers, SECRET, NOW + 300001), false);
  const rotated = new Headers(headers); rotated.set('svix-signature', 'v1,' + btoa('x'.repeat(32)) + ' ' + headers.get('svix-signature'));
  assert.equal(await verifySvix('{}', rotated, SECRET, NOW), true);
});

test('assinatura válida mantém dry-run e ignora tipos desconhecidos sem rede ou escrita', async t => {
  t.mock.method(Date, 'now', () => NOW);
  t.mock.method(globalThis, 'fetch', () => { throw Error('webhook_must_not_call_any_provider'); });
  const env = { RESEND_WEBHOOK_SECRET: SECRET, RESEND_WEBHOOK_WRITE_ENABLED: 'true' };
  const event = JSON.stringify({ type: 'email.delivered', data: { email_id: 'synthetic-message-id' } });
  const response = await webhook.fetch(await requestFor(event), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true, mode: 'dry_run', crm_writes_enabled: false });
  const ignored = await webhook.fetch(await requestFor(JSON.stringify({ type: 'unknown.type' })), env);
  assert.deepEqual(await ignored.json(), { accepted: true, ignored: true });
  for (const id of ['', 'x'.repeat(201), 'line\nbreak']) {
    const invalid = await webhook.fetch(await requestFor(JSON.stringify({ type: 'email.sent', data: { email_id: id } })), env);
    assert.equal(invalid.status, 400); assert.deepEqual(await invalid.json(), { error: 'missing_email_id' });
  }
});

test('64 KiB exatos são permitidos; rotas e health mantêm o contrato sem guardar respostas', async () => {
  const payload = 'x'.repeat(65536);
  assert.equal(await readWebhookBody(new Request(URL, { method: 'POST', body: payload })), payload);
  const health = await webhook.fetch(new Request('https://webhook.example.invalid/health'), {});
  assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ok', sending_enabled: false, crm_writes_enabled: false });
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal((await webhook.fetch(new Request(URL), {})).status, 404);
});
