"""Registo de eventos Resend: modo de simulação por defeito.

Este módulo NÃO envia emails nem aceita webhooks públicos. Para eventos reais,
exige uma integração autenticada que valide a assinatura antes de chamar apply_event.
"""
from datetime import datetime, timezone

EVENT_STATES = {
    "email.sent": "Enviado",
    "email.delivered": "Entregue",
    "email.bounced": "Bounce",
    "email.complained": "Spam",
    "email.delivery_delayed": "Entrega atrasada",
    "email.failed": "Erro",
}
SUPPRESSION_STATES = {"Bounce", "Spam", "Cancelou subscrição"}
ALLOWED_FIELDS = ("Data 1.º envio", "Data último envio", "N.º emails enviados",
                  "Estado email Resend", "ID mensagem Resend", "Não contactar")


def normalize_event(payload):
    """Normaliza apenas eventos Resend previamente autenticados pelo integrador."""
    if not isinstance(payload, dict):
        raise ValueError("Evento inválido")
    kind = payload.get("type")
    if kind not in EVENT_STATES:
        raise ValueError("Tipo de evento não suportado")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("Dados do evento inválidos")
    message_id = str(data.get("email_id") or "").strip()
    if not message_id or len(message_id) > 128:
        raise ValueError("ID Resend em falta ou inválido")
    return {"event_type": kind, "message_id": message_id,
            "state": EVENT_STATES[kind]}


def apply_event_to_row(row, event):
    """Atualiza apenas estado de um ID já registado; não cria envios."""
    result = list(row) + [""] * max(0, 26 - len(row))
    if str(result[22]).strip() != event["message_id"]:
        return None
    current = str(result[21]).strip()
    # Eventos tardios não podem reabrir um contacto suprimido.
    if current in SUPPRESSION_STATES and event["state"] not in SUPPRESSION_STATES:
        return result
    result[21] = event["state"]
    if event["state"] in SUPPRESSION_STATES:
        result[24] = "Sim"
    return result


def plan_event_updates(rows, payload, authenticated=False):
    """Gera plano de alterações sem escrita; recusa eventos não autenticados."""
    if not authenticated:
        raise PermissionError("Assinatura do webhook ainda não validada")
    event = normalize_event(payload)
    updates = []
    for index, row in enumerate(rows, start=2):
        updated = apply_event_to_row(row, event)
        if updated is not None and updated != (list(row) + [""] * max(0, 26 - len(row))):
            updates.append({"crm_row": index, "state": updated[21],
                            "block_contact": updated[24] == "Sim"})
    if len(updates) > 1:
        raise RuntimeError("ID Resend duplicado no CRM: alterações recusadas")
    return updates


def plan_attempt(row, email_id, sent_at=None):
    """Plano de registo de envio confirmado; não altera o CRM."""
    if str(row[24]).strip().casefold() == "sim":
        raise PermissionError("Contacto bloqueado")
    if len(row) > 22 and str(row[22]).strip():
        raise ValueError("Já existe ID Resend registado")
    if not email_id or len(str(email_id)) > 128:
        raise ValueError("ID Resend inválido")
    sent_at = sent_at or datetime.now(timezone.utc).isoformat()
    count = int(str(row[20]).strip() or "0")
    return {"Data 1.º envio": str(row[17]).strip() or sent_at,
            "Data último envio": sent_at, "N.º emails enviados": count + 1,
            "Estado email Resend": "Enviado", "ID mensagem Resend": str(email_id)}
