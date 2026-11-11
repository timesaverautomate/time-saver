#!/usr/bin/env python3
"""TimeSaver: envio B2B estritamente aprovado, idempotente e auditável.

Nunca aprova leads. O único desbloqueio é uma revisão humana documentada no CRM.
O agendamento é serializado pelo mesmo grupo de concorrência da pesquisa.
"""
import hashlib
import os
import re
from collections import Counter
from datetime import datetime, timedelta
from urllib.parse import quote

import requests
import prospect_crm as crm

MAX_OUTREACH_PER_DAY = 5
MAX_RECONCILE_PER_RUN = 45
SENDER_DOMAIN = "timesaverautomate.com"
ALLOWED_EVENTS = {
    "sent": "Enviado",
    "delivered": "Entregue",
    "opened": "Entregue",
    "clicked": "Entregue",
    "delivery_delayed": "Entrega atrasada",
    "bounced": "Bounce",
    "complained": "Spam",
    "suppressed": "Suprimido",
    "failed": "Erro",
}
TERMINAL = {"Bounce", "Spam", "Suprimido"}
BLOCK_SEND = {"Bounce", "Spam", "Suprimido", "Cancelou subscrição", "Erro"}


def text_cell(row, index):
    return str(row[index]).strip() if len(row) > index and row[index] is not None else ""


def read_review(credentials, http=requests):
    url = crm.API + "/values/" + quote("'Revisão Comercial'!A1:S10000", safe="")
    response = http.get(url, headers={"Authorization": "Bearer " + credentials.token},
                        timeout=30)
    response.raise_for_status()
    values = response.json().get("values", [])
    if not values or values[0] != crm.REVIEW_HEADERS:
        raise RuntimeError("Cabeçalhos de revisão inválidos")
    return values[1:]


def read_crm(credentials, http=requests):
    if http is requests:
        return crm.read_rows(credentials)
    url = crm.API + "/values/" + quote("'Pedidos'!A1:Z10000", safe="")
    response = http.get(url, headers={"Authorization": "Bearer " + credentials.token},
                        timeout=30)
    response.raise_for_status()
    values = response.json().get("values", [])
    if not values or values[0] != crm.HEADERS:
        raise RuntimeError("Cabeçalhos CRM inválidos")
    return values[1:]


def index_reviews(reviews):
    result = {}
    duplicates = set()
    for review in reviews:
        line = text_cell(review, 11)
        if not line or not line.isdigit():
            continue
        if line in result:
            duplicates.add(line)
        result[line] = review
    for line in duplicates:
        result.pop(line, None)
    return result


def already_contacted_domain(crm_rows):
    domains, emails = set(), set()
    for row in crm_rows:
        sent = text_cell(row, 20) not in ("", "0") or bool(text_cell(row, 22))
        if not sent:
            continue
        business_domain = crm.domain(text_cell(row, 3))
        if business_domain:
            domains.add(business_domain)
        email = text_cell(row, 4).lower()
        if email:
            emails.add(email)
    return domains, emails


def select_approved(crm_rows, reviews, today=None, limit=MAX_OUTREACH_PER_DAY):
    """Decide sem efeitos externos e devolve (linha real, linha, revisão)."""
    today = today or datetime.now(crm.ZoneInfo("Europe/Lisbon")).date()
    by_line = index_reviews(reviews)
    suppression = crm.suppression_index(crm_rows)
    sent_domains, sent_emails = already_contacted_domain(crm_rows)
    selected, reasons = [], Counter()
    batch_domains, batch_emails = set(), set()
    for line, row in enumerate(crm_rows, start=2):
        if not text_cell(row, 0):
            continue
        review = by_line.get(str(line))
        if not review:
            reasons["Revisão inexistente, ambígua ou sem linha estável"] += 1
            continue
        if text_cell(review, 11) != str(line):
            reasons["Número de linha incompatível"] += 1
            continue
        if text_cell(review, 2) != text_cell(row, 2):
            reasons["Localidade da revisão divergente"] += 1
            continue
        allowed, reason = crm.evaluate_send_eligibility(row, review, suppression, today=today)
        if not allowed:
            reasons[reason] += 1
            continue
        email = text_cell(row, 4).lower()
        business_domain = crm.domain(text_cell(row, 3))
        if email in sent_emails or business_domain in sent_domains:
            reasons["Empresa ou email já contactado"] += 1
            continue
        if email in batch_emails or business_domain in batch_domains:
            reasons["Empresa duplicada no lote"] += 1
            continue
        selected.append((line, row, review))
        batch_emails.add(email)
        batch_domains.add(business_domain)
    selected.sort(key=lambda x: crm.prospect_score(x[1]), reverse=True)
    return selected[:limit], reasons


def count_sends_today(rows, day):
    return sum(1 for row in rows if text_cell(row, 18).startswith(day) and
               text_cell(row, 20) not in ("", "0"))


def idempotency_for(row):
    email = text_cell(row, 4).lower()
    d = crm.domain(text_cell(row, 3))
    key = hashlib.sha256((d + "\n" + email).encode()).hexdigest()[:32]
    return "timesaver-b2b-v1-" + key


def reservation_for(row):
    return "Reservado: " + idempotency_for(row)


def batch_cells(credentials, updates, http=requests):
    if not updates:
        return
    if len(updates) > 10:
        raise ValueError("Demasiadas alterações de uma só vez")
    for entry in updates:
        if not re.fullmatch(r"'Pedidos'![A-Z]{1,2}[2-9][0-9]*(:[A-Z]{1,2}[2-9][0-9]*)?", entry["range"]):
            raise ValueError("Intervalo de escrita não aprovado")
    response = http.post(
        crm.API + "/values:batchUpdate",
        headers={"Authorization": "Bearer " + credentials.token,
                 "Content-Type": "application/json"},
        json={"valueInputOption": "RAW", "data": updates}, timeout=30
    )
    response.raise_for_status()
    expected = sum(len(v) for item in updates for v in item["values"])
    if response.json().get("totalUpdatedCells") != expected:
        raise RuntimeError("Google Sheets não confirmou a escrita integral")


def reserve(credentials, line, row, http=requests):
    marker = reservation_for(row)
    batch_cells(credentials, [{"range": f"'Pedidos'!V{line}",
                               "values": [[marker]]}], http)
    return marker


def resend_payload(row, review, sender):
    if not sender.lower().endswith("@" + SENDER_DOMAIN):
        raise ValueError("Remetente não pertence ao domínio TimeSaver")
    email = text_cell(row, 4).lower()
    if not crm.EMAIL_RE.fullmatch(email):
        raise ValueError("Destinatário inválido")
    subject, message = crm.proposal_content(row, text_cell(review, 17))
    return {
        "from": "TimeSaver <" + sender + ">",
        "to": [email],
        "reply_to": "timesaverautomate@gmail.com",
        "subject": subject,
        "text": message,
    }


def safe_env(mode, env):
    if mode not in {"preview", "send", "reconcile"}:
        raise RuntimeError("Modo desconhecido")
    if mode != "preview":
        if any([
            env.get("GITHUB_REPOSITORY_ID") != "1452563434",
            env.get("GITHUB_REPOSITORY") != "timesaverautomate/time-saver",
            env.get("GITHUB_REF") != "refs/heads/main",
            env.get("GITHUB_WORKFLOW_REF") !=
              "timesaverautomate/time-saver/.github/workflows/outreach-legal.yml@refs/heads/main",
        ]):
            raise RuntimeError("Execução fora do workflow autorizado")
        if env.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
            if env.get("CRM_OUTREACH_CONFIRM") != "ENVIAR" and mode == "send":
                raise RuntimeError("Envio manual não confirmado")
        elif env.get("GITHUB_EVENT_NAME") != "schedule":
            raise RuntimeError("Evento sem autorização para envio ou reconciliação")
    return mode


def send_approved(credentials, api_key, sender, *, today=None, http=requests):
    if not api_key.startswith("re_"):
        raise RuntimeError("API Resend não configurada")
    day = today or crm.today_lisbon()
    rows = read_crm(credentials, http)
    remaining = max(0, MAX_OUTREACH_PER_DAY - count_sends_today(rows, day))
    reviews = read_review(credentials, http)
    candidates, reasons = select_approved(rows, reviews, today=crm.date.fromisoformat(day),
                                           limit=remaining)
    print(f"TimeSaver: {len(rows)} registos, {len(candidates)} aprovados no lote, "
          f"quota disponível {remaining}.")
    print("Bloqueios:", dict(reasons))
    sent = 0
    for line, candidate_row, candidate_review in candidates:
        # Releitura imediatamente antes de cada reserva. Sem CAS na Sheets:
        # a reserva persiste em falhas/timeout e exige reconciliação manual.
        latest = read_crm(credentials, http)
        fresh = latest[line-2] if len(latest) >= line-1 else []
        if not fresh or text_cell(fresh, 25) != text_cell(candidate_row, 25) \
                or text_cell(fresh, 4).lower() != text_cell(candidate_row, 4).lower():
            print(f"Linha {line}: identidade alterada; recusado.")
            continue
        if count_sends_today(latest, day) >= MAX_OUTREACH_PER_DAY:
            break
        refreshed_reviews = read_review(credentials, http)
        eligible, _ = select_approved(latest, refreshed_reviews,
                            today=crm.date.fromisoformat(day), limit=10000)
        match = next((r for r in eligible if r[0] == line), None)
        if not match:
            print(f"Linha {line}: deixou de estar autorizada; recusado.")
            continue
        _, row, review = match
        payload = resend_payload(row, review, sender)
        marker = reserve(credentials, line, row, http)
        confirm = read_crm(credentials, http)
        if (len(confirm) < line-1 or
            text_cell(confirm[line-2], 21) != marker or
            text_cell(confirm[line-2], 25) != text_cell(row, 25)):
            raise RuntimeError(f"Linha {line}: reserva não confirmada; intervenção necessária")
        # Não repetir automaticamente em caso de timeout. A reserva mantém-se.
        response = http.post("https://api.resend.com/emails",
            headers={"Authorization": "Bearer " + api_key,
                     "Idempotency-Key": idempotency_for(row),
                     "Content-Type": "application/json"},
            json=payload, timeout=20)
        response.raise_for_status()
        email_id = response.json().get("id")
        if not isinstance(email_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{6,128}", email_id):
            raise RuntimeError(f"Linha {line}: Resend não devolveu ID válido; rever reserva")
        now = datetime.now(crm.ZoneInfo("Europe/Lisbon")).isoformat(timespec="seconds")
        follow = (crm.date.fromisoformat(day) + timedelta(days=7)).isoformat()
        updates = [
            {"range": f"'Pedidos'!R{line}:W{line}",
             "values": [[text_cell(row,17) or now,now,follow,
                         int(text_cell(row,20) or "0")+1,"Enviado",email_id]]},
            {"range": f"'Pedidos'!J{line}", "values": [["Email enviado"]]},
            {"range": f"'Pedidos'!L{line}:M{line}",
             "values": [["Rever resposta e oposição; sem follow-up automático", follow]]},
        ]
        try:
            batch_cells(credentials, updates, http)
        except Exception:
            # Não ocultar ID único; permite reconciliar sem reenviar.
            print(f"CRÍTICO: envio aceite, mas CRM por confirmar; linha {line}, ID Resend {email_id}")
            raise
        print(f"Envio comercial confirmado e registado, linha {line}.")
        sent += 1
    return {"sent": sent, "remaining": remaining, "eligible": len(candidates)}


def delivery_status(last_event, old_status):
    next_state = ALLOWED_EVENTS.get(str(last_event or "").lower())
    if not next_state:
        return None
    if old_status in TERMINAL or old_status == "Cancelou subscrição":
        return None
    if old_status == "Entregue" and next_state in {"Enviado","Entrega atrasada","Erro"}:
        return None
    return next_state if next_state != old_status else None


def reconcile(credentials, api_key, *, http=requests):
    if not api_key.startswith("re_"):
        raise RuntimeError("API Resend não configurada")
    rows = read_crm(credentials, http)
    examined, changed = 0, 0
    for line, row in enumerate(rows, start=2):
        email_id = text_cell(row, 22)
        if not email_id or not re.fullmatch(r"[A-Za-z0-9-]{6,128}", email_id):
            continue
        if text_cell(row, 21) in TERMINAL:
            continue
        if examined >= MAX_RECONCILE_PER_RUN:
            break
        examined += 1
        response = http.get("https://api.resend.com/emails/" + email_id,
                            headers={"Authorization":"Bearer " + api_key}, timeout=20)
        if not response.ok:
            print(f"Reconciliar linha {line}: HTTP {response.status_code}; sem alterações")
            continue
        payload = response.json()
        if payload.get("id") != email_id:
            continue
        recipients = payload.get("to") or []
        if text_cell(row,4).lower() not in [str(x).lower() for x in recipients]:
            print(f"Reconciliar linha {line}: destinatário divergente; sem alterações")
            continue
        status = delivery_status(payload.get("last_event"), text_cell(row,21))
        if not status:
            continue
        updates = [{"range":f"'Pedidos'!V{line}", "values":[[status]]}]
        if status in BLOCK_SEND:
            updates.append({"range":f"'Pedidos'!Y{line}", "values":[["Sim"]]})
        batch_cells(credentials, updates, http)
        changed += 1
    print(f"Resend: {examined} mensagens consultadas, {changed} estados atualizados.")
    return {"examined":examined, "updated":changed}


def report(mode, data):
    path = os.getenv("GITHUB_STEP_SUMMARY")
    if path:
        with open(path,"a",encoding="utf-8") as f:
            f.write("\n## TimeSaver — fluxo B2B seguro\n\n"
                    f"- Modo: {mode}\n"
                    + "\n".join(f"- {k}: {v}" for k,v in data.items())
                    + "\n- Nenhum contacto novo é aprovado automaticamente.\n")


def main():
    mode = safe_env(os.getenv("CRM_OUTREACH_MODE","preview"), os.environ)
    creds = crm.google_credentials()
    if mode == "reconcile":
        result = reconcile(creds, os.environ["RESEND_API_KEY"])
    elif mode == "send":
        result = send_approved(creds, os.environ["RESEND_API_KEY"],
                               os.environ["TEST_MAIL_FROM"])
    else:
        rows = read_crm(creds)
        selected, reasons = select_approved(rows, read_review(creds))
        result = {"avaliados":len(rows),"autorizados":len(selected),
                  "bloqueados":sum(reasons.values()), "enviados":0}
        print("Pré-visualização sem envios:", result, dict(reasons))
    report(mode, result)


if __name__ == "__main__":
    main()
