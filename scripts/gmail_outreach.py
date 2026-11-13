#!/usr/bin/env python3
"""TimeSaver: envio agendado pelo Gmail API, SOMENTE opt-ins comprovados.

Sem envio por omissão. Requer OAuth da caixa timesaverautomate@gmail.com,
aprovação humana específica, prova documental, quota gradual e reserva no CRM.
Nunca usar uma service account do Sheets para impersonar Gmail pessoal.
"""
import base64
import os
import re
from datetime import date, datetime, timedelta
from email.message import EmailMessage

import requests
import prospect_crm as crm
import outreach_approved as outreach

GMAIL_SENDER = "timesaverautomate@gmail.com"
START_DATE = date(2026, 11, 16)
STAGES = (5, 10, 15, 20, 30)
GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
PROOF_URL = re.compile(r"(?:^|;)\s*OPTIN_PROVA=(https://[^\s;]+)")
PROOF_DATE = re.compile(r"(?:^|;)\s*OPTIN_DATA=(\d{4}-\d{2}-\d{2})(?:;|$)")
GMAIL_ID = re.compile(r"^[0-9a-fA-F]{8,64}$")


def ramp_cap(day):
    """5/10/15/20/30 em semanas sucessivas, nunca em fins de semana."""
    if isinstance(day, str):
        day = date.fromisoformat(day)
    if day.weekday() >= 5 or day < START_DATE:
        return 0
    return STAGES[min((day - START_DATE).days // 7, len(STAGES) - 1)]


def optin_evidence(review, today):
    """Exige dois campos documentados pela revisão humana, não apenas um rótulo."""
    notes = outreach.text_cell(review, 10)
    url, stamped = PROOF_URL.search(notes), PROOF_DATE.search(notes)
    if not url or not stamped:
        return False
    try:
        stamp = date.fromisoformat(stamped.group(1))
    except ValueError:
        return False
    if stamp > today or (today - stamp).days > 365:
        return False
    return outreach.text_cell(review, 9) == "Consentimento documentado"


def safe_mode(mode, env):
    if mode not in ("preview", "send"):
        raise RuntimeError("Modo Gmail desconhecido")
    if mode == "preview":
        return mode
    required = {
        "GITHUB_REPOSITORY_ID": "1452563434",
        "GITHUB_REPOSITORY": "timesaverautomate/time-saver",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_WORKFLOW_REF":
            "timesaverautomate/time-saver/.github/workflows/gmail-outreach.yml@refs/heads/main",
        "GMAIL_SEND_ENABLED": "true",
    }
    if any(env.get(key) != value for key, value in required.items()):
        raise RuntimeError("Gmail não ativado ou execução fora do repositório autorizado")
    if env.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
        if env.get("GMAIL_SEND_CONFIRM") != "ENVIAR":
            raise RuntimeError("Envio manual não confirmado")
    elif env.get("GITHUB_EVENT_NAME") != "schedule":
        raise RuntimeError("Evento não autorizado a enviar emails")
    return mode


def approved_candidates(rows, reviews, day, cap):
    selected, reasons = outreach.select_approved(
        rows, reviews, today=date.fromisoformat(day), limit=10000
    )
    remaining = max(0, cap - outreach.count_sends_today(rows, day))
    documented = [(line, row, review) for line, row, review in selected
                  if optin_evidence(review, date.fromisoformat(day))]
    return documented[:remaining], {
        "eligible_for_crm": len(selected),
        "documented_optin": len(documented),
        "remaining_today": remaining,
        "missing_documentary_proof": len(selected) - len(documented),
        "blocked_other_reasons": sum(reasons.values()),
    }


def oauth_access_token(env, http=requests):
    keys = ("GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN")
    if any(not env.get(key) for key in keys):
        raise RuntimeError("OAuth Gmail da conta TimeSaver em falta")
    response = http.post(TOKEN_URL, data={
        "client_id": env["GMAIL_OAUTH_CLIENT_ID"],
        "client_secret": env["GMAIL_OAUTH_CLIENT_SECRET"],
        "refresh_token": env["GMAIL_OAUTH_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }, timeout=20, allow_redirects=False)
    response.raise_for_status()
    data = response.json()
    token = data.get("access_token")
    scopes = data.get("scope", "").split()
    if (not isinstance(token, str) or len(token) < 30 or
            (scopes and GMAIL_SCOPE not in scopes)):
        raise RuntimeError("OAuth Gmail não devolveu permissão de envio válida")
    return token


def check_sender_identity(access_token, http=requests):
    response = http.get(USERINFO_URL,
                        headers={"Authorization": "Bearer " + access_token},
                        timeout=20, allow_redirects=False)
    response.raise_for_status()
    data = response.json()
    if data.get("email_verified") is not True or str(data.get("email", "")).casefold() != GMAIL_SENDER:
        raise RuntimeError("A conta autorizada não é timesaverautomate@gmail.com")
    return GMAIL_SENDER


def email_raw(row, review):
    subject, text = crm.proposal_content(row, outreach.text_cell(review, 17))
    msg = EmailMessage()
    msg["From"] = "TimeSaver <" + GMAIL_SENDER + ">"
    msg["To"] = outreach.text_cell(row, 4).lower()
    msg["Reply-To"] = GMAIL_SENDER
    msg["Subject"] = subject
    msg.set_content(text)
    return base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii").rstrip("=")


def send_once(credentials, env, *, day=None, http=requests):
    """Devolve contagem. Reserva sempre antes de qualquer chamada Gmail.
    
    Sem repetição automática após erro de rede indeterminado ou erro Sheets.
    Só envia a opt-ins verificados na revisão comercial e com prova no CRM.
    """
    day = day or crm.today_lisbon()
    cap = ramp_cap(day)
    if not cap:
        return {"cap": cap, "eligible": 0, "sent": 0}
    rows = outreach.read_crm(credentials, http)
    reviews = outreach.read_review(credentials, http)
    selected, audit = approved_candidates(rows, reviews, day, cap)
    print("Gmail TimeSaver: teto do dia:", cap, "; auditoria:", audit, flush=True)
    if not selected:
        return {"cap": cap, "eligible": 0, "sent": 0, **audit}
    token = oauth_access_token(env, http)
    check_sender_identity(token, http)
    sent = 0
    for line, candidate_row, _ in selected:
        latest = outreach.read_crm(credentials, http)
        fresh = latest[line-2] if len(latest) >= line-1 else []
        if not fresh or outreach.text_cell(fresh, 25) != outreach.text_cell(candidate_row, 25) \
                or outreach.text_cell(fresh, 4).lower() != outreach.text_cell(candidate_row, 4).lower():
            print("Gmail: linha alterada; ignorada:", line)
            continue
        all_approvals = outreach.read_review(credentials, http)
        eligible, _ = approved_candidates(latest, all_approvals, day, cap)
        match = next((item for item in eligible if item[0] == line), None)
        if not match:
            print("Gmail: opt-in já não elegível:", line)
            continue
        _, row, review = match
        raw = email_raw(row, review)
        marker = outreach.reserve(credentials, line, row, http)
        confirmed = outreach.read_crm(credentials, http)
        if (len(confirmed) < line-1 or
            outreach.text_cell(confirmed[line-2], 21) != marker or
            outreach.text_cell(confirmed[line-2], 25) != outreach.text_cell(row, 25)):
            raise RuntimeError("Reserva Gmail não confirmada; intervenção necessária")
        # Depois da reserva, voltar a verificar o consentimento no CRM atualizado.
        newest_reviews = outreach.index_reviews(outreach.read_review(credentials, http))
        current_review = newest_reviews.get(str(line))
        check_row = list(confirmed[line-2])
        check_row[21] = ""
        allowed, _ = crm.evaluate_send_eligibility(
            check_row, current_review or [], crm.suppression_index(confirmed),
            today=date.fromisoformat(day)
        )
        if (not allowed or not current_review or
            not optin_evidence(current_review, date.fromisoformat(day)) or
            not crm.in_target_segment(check_row)):
            raise RuntimeError("Opt-in alterado após a reserva; nenhuma mensagem enviada")
        # O Gmail não oferece idempotência para sends. Em timeout, a reserva fica.
        result = http.post(SEND_URL, json={"raw": raw}, headers={
            "Authorization": "Bearer " + token, "Content-Type": "application/json"
        }, timeout=20, allow_redirects=False)
        result.raise_for_status()
        gmail_id = result.json().get("id")
        if not isinstance(gmail_id, str) or not GMAIL_ID.fullmatch(gmail_id):
            raise RuntimeError("Gmail aceitou resposta sem ID válido; manter reserva")
        now = datetime.now(crm.ZoneInfo("Europe/Lisbon")).isoformat(timespec="seconds")
        follow = (date.fromisoformat(day) + timedelta(days=7)).isoformat()
        updates = [
            {"range": f"'Pedidos'!R{line}:W{line}",
             "values": [[outreach.text_cell(row, 17) or now, now, follow,
                         int(outreach.text_cell(row, 20) or "0") + 1,
                         "Enviado Gmail", "gmail:" + gmail_id]]},
            {"range": f"'Pedidos'!J{line}", "values": [["Email enviado"]]},
            {"range": f"'Pedidos'!L{line}:M{line}",
             "values": [["Verificar resposta/oposição; sem follow-up automático", follow]]},
        ]
        try:
            outreach.batch_cells(credentials, updates, http)
        except Exception:
            print(f"CRÍTICO: Gmail ID gmail:{gmail_id} aceite, linha {line}; CRM não confirmado")
            raise
        sent += 1
        print("Gmail: envio aceite e registado, linha", line, flush=True)
    return {"cap": cap, "sent": sent, "eligible": len(selected), **audit}


def main():
    env = os.environ
    mode = safe_mode(env.get("GMAIL_OUTREACH_MODE", "preview"), env)
    credentials = crm.google_credentials()
    day = crm.today_lisbon()
    if mode == "preview":
        rows = outreach.read_crm(credentials)
        approved, audit = approved_candidates(
            rows, outreach.read_review(credentials), day, ramp_cap(day))
        result = {"cap": ramp_cap(day), "eligible": len(approved),
                  "sent": 0, **audit}
        print("Gmail: simulação sem envios:", result, flush=True)
    else:
        result = send_once(credentials, env, day=day)
    outreach.report("gmail-" + mode, result)


if __name__ == "__main__":
    main()
