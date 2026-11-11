// Receção segura de eventos Resend (Svix), sem envios nem escrita no CRM.
// O modo de escrita permanece desativado até existir integração validada.
const types = new Set([
  "email.sent", "email.delivered", "email.bounced",
  "email.complained", "email.delivery_delayed", "email.failed",
]);

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
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

export async function verifySvix(body, headers, secret, now = Date.now()) {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !secret?.startsWith("whsec_")) return false;
  if (!/^\\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  let key;
  try { key = decodeBase64(secret.slice(6)); } catch { return false; }
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, signed));
  for (const entry of signatures.split(" ")) {
    if (!entry.startsWith("v1,")) continue;
    try {
      if (constantTimeEqual(expected, decodeBase64(entry.slice(3)))) return true;
    } catch { /* malformed signature */ }
  }
  return false;
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
    if (Number(request.headers.get("content-length") || 0) > 65536) {
      return response({ error: "too_large" }, 413);
    }
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 65536) {
      return response({ error: "too_large" }, 413);
    }
    if (!await verifySvix(body, request.headers, env.RESEND_WEBHOOK_SECRET)) {
      return response({ error: "unauthorized" }, 401);
    }
    let event;
    try { event = JSON.parse(body); } catch { return response({ error: "invalid_json" }, 400); }
    if (!types.has(event?.type)) return response({ accepted: true, ignored: true });
    if (!event?.data?.email_id || typeof event.data.email_id !== "string") {
      return response({ error: "missing_email_id" }, 400);
    }
    // Não escrever no CRM, mesmo que a flag seja alterada, até implementarmos
    // autenticação Google, deduplicação e testes end-to-end.
    return response({ accepted: true, mode: "dry_run", crm_writes_enabled: false });
  },
};
