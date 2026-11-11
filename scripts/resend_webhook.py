"""Endpoint Resend seguro, desligado por defeito.

Executar apenas num servidor HTTPS configurado com RESEND_WEBHOOK_SECRET,
GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEET_ID e RESEND_WEBHOOK_WRITE_ENABLED=true.
Não envia emails. Nunca regista o corpo do webhook em logs.
"""
import json
import os

from flask import Flask, abort, jsonify, request
from svix.webhooks import Webhook

from resend_events import write_sheet_updates

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 65536


def verified_payload(body, headers, secret):
    if not secret:
        raise RuntimeError("Segredo de webhook não configurado")
    svix_headers = {
        "svix-id": headers.get("svix-id", ""),
        "svix-timestamp": headers.get("svix-timestamp", ""),
        "svix-signature": headers.get("svix-signature", ""),
    }
    if not all(svix_headers.values()):
        raise PermissionError("Assinatura em falta")
    try:
        return Webhook(secret).verify(body, svix_headers)
    except Exception as exc:
        raise PermissionError("Assinatura inválida") from exc


def google_session():
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    info = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    return AuthorizedSession(creds)


def crm_rows(session, sheet_id):
    from urllib.parse import quote
    url = ("https://sheets.googleapis.com/v4/spreadsheets/"
           + quote(sheet_id, safe="") + "/values/"
           + quote("Pedidos!A1:Z10000", safe=""))
    response = session.get(url, timeout=30)
    response.raise_for_status()
    values = response.json().get("values", [])
    # Nunca operar se o esquema da folha for desconhecido.
    if not values or len(values[0]) != 26 or values[0][22] != "ID mensagem Resend" or values[0][24] != "Não contactar":
        raise RuntimeError("Cabeçalhos do CRM incompatíveis")
    return values[1:]


@app.post("/webhooks/resend")
def resend_webhook():
    try:
        payload = verified_payload(
            request.get_data(as_text=True), request.headers,
            os.environ.get("RESEND_WEBHOOK_SECRET", ""))
    except (PermissionError, RuntimeError):
        abort(401)
    if payload.get("type") not in {
        "email.sent", "email.delivered", "email.bounced",
        "email.complained", "email.delivery_delayed", "email.failed",
    }:
        return jsonify({"accepted": True, "ignored": True}), 200
    if os.environ.get("RESEND_WEBHOOK_WRITE_ENABLED") != "true":
        return jsonify({"accepted": True, "mode": "dry_run"}), 200
    try:
        sheet_id = os.environ["GOOGLE_SHEET_ID"]
        session = google_session()
        result = write_sheet_updates(session, sheet_id, crm_rows(session, sheet_id),
                                     payload, authenticated=True, enabled=True)
        return jsonify({"accepted": True, **result}), 200
    except (ValueError, KeyError):
        abort(400)
    except Exception:
        # Falhas temporárias devem provocar nova tentativa do emissor.
        abort(503)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "sending_enabled": False})
