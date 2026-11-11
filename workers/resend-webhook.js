// Receção segura de eventos Resend (Svix), sem envios nem escrita no CRM.
// O modo de escrita permanece desativado até existir integração validada.
const types = new Set([
  "email.sent", "email.delivered", "email.bounced",
  "email.complained", "email.delivery_delayed", "email.failed",
]);

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

const MAX_BODY = 65536;
export class WebhookBodyError extends Error {
  constructor(code, status) { super(code); this.status = status; }
}
function validateBodyHeaders(headers) {
  const encoding = headers.get("content-encoding");
  if (encoding && encoding !== "identity") throw new WebhookBodyError("unsupported_encoding", 415);
  const length = headers.get("content-length");
  if (length !== null && (!/^\d{1,6}$/.test(length) || Number(length) > MAX_BODY)) {
    throw new WebhookBodyError("too_large", 413);
  }
}
export async function readWebhookBody(request, { timeoutMs = 8000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000) throw Error("invalid_timeout");
  validateBodyHeaders(request.headers);
  const reader = request.body?.getReader();
  if (!reader) throw new WebhookBodyError("invalid_body", 400);
  const chunks = []; let size = 0, timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new WebhookBodyError("body_timeout", 408)), timeoutMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new WebhookBodyError("invalid_body", 400);
      size += value.byteLength;
      if (size > MAX_BODY) throw new WebhookBodyError("too_large", 413);
      chunks.push(value);
    }
  } catch (error) {
    // Um produtor lento não pode prender a resposta através de cancel().
    try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* best effort */ }
    throw error;
  } finally {
    clearTimeout(timer);
    try { reader.releaseLock(); } catch { /* stream already closed */ }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new WebhookBodyError("invalid_body", 400); }
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function decodeBase64(s) {
  const binary = atob(s);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function signingInputs(headers, secret, now) {
  let id, timestamp, signatures;
  try {
    id = headers.get("svix-id"); timestamp = headers.get("svix-timestamp");
    signatures = headers.get("svix-signature");
  } catch { return { valid: false, reason: "missing_headers" }; }
  if (!id || !timestamp || !signatures) return { valid: false, reason: "missing_headers" };
  if (typeof secret !== "string" || !secret.startsWith("whsec_")) {
    return { valid: false, reason: "secret_missing_or_invalid_format" };
  }
  if (typeof timestamp !== "string" || !/^\d{10}$/.test(timestamp) || !Number.isSafeInteger(now)) {
    return { valid: false, reason: "invalid_timestamp" };
  }
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) {
    return { valid: false, reason: "timestamp_outside_5_min_window" };
  }
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
    return { valid: false, reason: "invalid_header_format" };
  }
  if (typeof signatures !== "string" || signatures.length > 1024) {
    return { valid: false, reason: "invalid_signature_format" };
  }
  if (!/^whsec_[A-Za-z0-9+/]{22,172}={0,2}$/.test(secret)) {
    return { valid: false, reason: "invalid_secret_encoding" };
  }
  try {
    const key = decodeBase64(secret.slice(6));
    if (key.length < 16 || key.length > 128) return { valid: false, reason: "invalid_secret_encoding" };
    const entries = signatures.split(" ").filter(Boolean);
    if (entries.length > 16) return { valid: false, reason: "invalid_signature_format" };
    return { valid: true, id, timestamp, key, entries };
  } catch { return { valid: false, reason: "invalid_secret_encoding" }; }
}

export async function verifySvixDetailed(body, headers, secret, now = Date.now()) {
  const inputs = signingInputs(headers, secret, now);
  if (!inputs.valid) return { valid: false, reason: inputs.reason };
  if (typeof body !== "string" || body.length > MAX_BODY) return { valid: false, reason: "signature_mismatch" };
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "raw", inputs.key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const signed = new TextEncoder().encode(`${inputs.id}.${inputs.timestamp}.${body}`);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, signed));
    for (const entry of inputs.entries) {
      if (!/^v1,[A-Za-z0-9+/]{43}=?$/.test(entry)) continue;
      try {
        if (constantTimeEqual(expected, decodeBase64(entry.slice(3)))) return { valid: true, reason: "verified" };
      } catch { /* malformed signature */ }
    }
  } catch { return { valid: false, reason: "signature_mismatch" }; }
  return { valid: false, reason: "signature_mismatch" };
}

export async function verifySvix(body, headers, secret, now = Date.now()) {
  return (await verifySvixDetailed(body, headers, secret, now)).valid;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return response({ status: "ok", sending_enabled: false, crm_writes_enabled: false });
    }
    if (url.pathname !== "/webhooks/resend" || request.method !== "POST") {
      return response({ error: "not_found" }, 404);
    }
    let body;
    try {
      validateBodyHeaders(request.headers);
      const preliminary = signingInputs(request.headers, env?.RESEND_WEBHOOK_SECRET, Date.now());
      if (!preliminary.valid) {
        // Preservar o diagnóstico anónimo: apenas categoria fixa, sem dados recebidos.
        console.warn("resend_webhook_verification_failed", preliminary.reason);
        return response({ error: "unauthorized" }, 401);
      }
      body = await readWebhookBody(request);
    } catch (error) {
      if (error instanceof WebhookBodyError) return response({ error: error.message }, error.status);
      return response({ error: "invalid_body" }, 400);
    }
    const verification = await verifySvixDetailed(body, request.headers, env.RESEND_WEBHOOK_SECRET);
    if (!verification.valid) {
      // Registar apenas a categoria do erro, nunca headers, corpo ou segredo.
      console.warn("resend_webhook_verification_failed", verification.reason);
      return response({ error: "unauthorized" }, 401);
    }
    let event;
    try { event = JSON.parse(body); } catch { return response({ error: "invalid_json" }, 400); }
    if (!types.has(event?.type)) return response({ accepted: true, ignored: true });
    if (typeof event?.data?.email_id !== "string" || event.data.email_id.length < 1
      || event.data.email_id.length > 200 || /[\x00-\x20\x7f]/.test(event.data.email_id)) {
      return response({ error: "missing_email_id" }, 400);
    }
    // Não escrever no CRM, mesmo que a flag seja alterada, até implementarmos
    // autenticação Google, deduplicação e testes end-to-end.
    return response({ accepted: true, mode: "dry_run", crm_writes_enabled: false });
  },
};
