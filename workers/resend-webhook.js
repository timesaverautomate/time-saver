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


const CRM_ID = "1VYEBWJb_9cYGbO8nZa3d_qh1rLUH-H3xf-w4CnOLMS4";
function b64url(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
export async function googleToken(json, http = fetch, scope = "https://www.googleapis.com/auth/spreadsheets.readonly") {
  let c;
  try { c = JSON.parse(json); } catch { throw Error("invalid_credentials"); }
  if (c?.type !== "service_account" || !c.client_email || !c.private_key) throw Error("invalid_credentials");
  const now = Math.floor(Date.now()/1000);
  const enc = x => b64url(new TextEncoder().encode(JSON.stringify(x)));
  const unsigned = enc({alg:"RS256",typ:"JWT"})+"."+enc({iss:c.client_email,scope, aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600});
  const der = Uint8Array.from(atob(c.private_key.replace(/-----[^-]+-----|\s/g,"")), x=>x.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8",der,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const signature = b64url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned))));
  const r = await http("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:unsigned+"."+signature})});
  if (!r.ok) throw Error("google_auth_failed");
  const result = await r.json();
  if (!result.access_token) throw Error("google_auth_failed");
  return result.access_token;
}
export function planCrmEvent(rows,event) {
  const states = {"email.sent":"Enviado","email.delivered":"Entregue","email.bounced":"Bounce","email.complained":"Spam","email.delivery_delayed":"Entrega atrasada","email.failed":"Erro"};
  if (!states[event?.type] || typeof event?.data?.email_id !== "string") throw Error("invalid_crm_event");
  const matches=[];
  for(let i=1;i<rows.length;i++) if(String(rows[i]?.[22]??"").trim()===event.data.email_id) matches.push(i+1);
  if(matches.length>1) throw Error("duplicate_message_id");
  if(!matches.length) return {matched:false,planned_cells:0,updates:[]};
  const number=matches[0], row=rows[number-1],current=String(row[21]??"").trim(),next=states[event.type];
  const blocked=new Set(["Bounce","Spam","Cancelou subscrição"]);
  // Terminal delivery states cannot be reverted by late or replayed events.
  if(blocked.has(current)&&!blocked.has(next)) return {matched:true,planned_cells:0,updates:[]};
  if(current==="Entregue"&&["Enviado","Entrega atrasada"].includes(next)) return {matched:true,planned_cells:0,updates:[]};
  const updates=[];
  if(current!==next) updates.push({range:"'Pedidos'!V"+number,values:[[next]]});
  if(blocked.has(next)&&String(row[24]??"").trim().toLowerCase()!=="sim")
    updates.push({range:"'Pedidos'!Y"+number,values:[["Sim"]]});
  return {matched:true,planned_cells:updates.length,updates};
}
// Adapter for a future serialized writer. Never called by the public webhook yet.
// A Sheets batchUpdate is not compare-and-swap: concurrency control must precede activation.
export async function writePlannedCrmCells(credentialsJson, updates, http = fetch) {
  if (!Array.isArray(updates) || updates.length === 0) return {written_cells:0};
  if (updates.length > 2 || updates.some(u =>
    !/^'Pedidos'![VY][2-9][0-9]*$/.test(u.range) ||
    !Array.isArray(u.values) || u.values.length !== 1 ||
    !Array.isArray(u.values[0]) || u.values[0].length !== 1 ||
    typeof u.values[0][0] !== "string" ||
    (u.range.includes("!Y") && u.values[0][0] !== "Sim")
  )) throw Error("invalid_crm_updates");
  const rowNumbers = updates.map(u => u.range.match(/[0-9]+$/)[0]);
  if (new Set(rowNumbers).size !== 1 || new Set(updates.map(u=>u.range)).size !== updates.length)
    throw Error("invalid_crm_updates");
  const token = await googleToken(credentialsJson, http, "https://www.googleapis.com/auth/spreadsheets");
  const url = "https://sheets.googleapis.com/v4/spreadsheets/"+CRM_ID+"/values:batchUpdate";
  const r = await http(url, {method:"POST",headers:{
    authorization:"Bearer "+token,"content-type":"application/json"
  },body:JSON.stringify({valueInputOption:"RAW",data:updates})});
  if (!r.ok) throw Error("google_sheet_write_failed");
  const result = await r.json();
  if (result.totalUpdatedCells !== updates.length) throw Error("google_sheet_write_incomplete");
  return {written_cells:result.totalUpdatedCells};
}

export async function checkCrm(json,event,http=fetch) {
  const token=await googleToken(json,http);
  const url="https://sheets.googleapis.com/v4/spreadsheets/"+CRM_ID+"/values/"+encodeURIComponent("'Pedidos'!A1:Z5000");
  const r=await http(url,{headers:{authorization:"Bearer "+token}});
  if(!r.ok) throw Error("google_sheet_read_failed");
  const data=await r.json();
  if(!Array.isArray(data.values)||data.values[0]?.[22]!=="ID mensagem Resend") throw Error("crm_schema_mismatch");
  const {updates, ...summary}=planCrmEvent(data.values,event);
  return summary;
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
    // Read-only integration: no CRM writes, even when the flag is changed.
    if (!env?.GOOGLE_SERVICE_ACCOUNT_JSON) return response({accepted:true,mode:"dry_run",crm_writes_enabled:false,crm_check:"credentials_missing"});
    try {
      const plan=await checkCrm(env.GOOGLE_SERVICE_ACCOUNT_JSON,event);
      return response({accepted:true,mode:"dry_run",crm_writes_enabled:false,crm_check:"ok",...plan});
    } catch(error) {
      const safe=new Set(["invalid_credentials","google_auth_failed","google_sheet_read_failed","crm_schema_mismatch","duplicate_message_id"]);
      const reason=safe.has(error?.message)?error.message:"crm_check_failed";
      console.warn("resend_crm_read_only_check_failed",reason);
      return response({accepted:true,mode:"dry_run",crm_writes_enabled:false,crm_check:reason});
    }
  },
};
