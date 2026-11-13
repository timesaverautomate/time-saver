#!/usr/bin/env python3
"""Espelho auditável de envios reais do CRM 'Pedidos' para 'Pedidos chat'.

Nunca faz envios. Não converte rascunhos em mensagens enviadas. A identidade
da mensagem do fornecedor é a chave única, inclusive entre reexecuções.
"""
import hashlib
import os
import re
from datetime import date
from urllib.parse import quote

import requests
import prospect_crm as crm
import outreach_approved as outreach

CHAT_TAB = "Pedidos chat"
CHAT_HEADERS = [
    "Referência", "Data/hora UTC", "Nome", "Email", "Empresa", "Serviço",
    "Objetivo", "Frequência", "Ponto de partida", "Ferramentas",
    "Detalhes", "Prazo", "Orçamento", "Descrição do pedido", "Estado",
]
MIN_DATE = date(2026, 11, 13)
MAX_CHAT_ROWS = 1000


def sent_message(row):
    """Devolve (fornecedor, id) só para mensagens confirmadas, não reservas."""
    count = outreach.text_cell(row, 20)
    last = outreach.text_cell(row, 18)
    ident = outreach.text_cell(row, 22)
    state = outreach.text_cell(row, 21)
    if not re.fullmatch(r"[1-9][0-9]*", count):
        return None
    try:
        if date.fromisoformat(last[:10]) < MIN_DATE:
            return None
    except ValueError:
        return None
    if state.startswith("Reservado") or not ident:
        return None
    if ident.startswith("gmail:"):
        if not re.fullmatch(r"gmail:[a-fA-F0-9]{8,64}", ident):
            return None
        return ("Gmail", ident.split(":", 1)[1])
    if not re.fullmatch(r"[A-Za-z0-9-]{6,128}", ident):
        return None
    return ("Resend", ident)


def message_reference(provider, message_id):
    if provider not in ("Gmail", "Resend") or not re.fullmatch(r"[A-Za-z0-9-]{6,128}", message_id):
        raise ValueError("Identificador de envio inválido")
    digest = hashlib.sha256((provider + ":" + message_id).encode()).hexdigest()[:20]
    return "CHAT-ENV-" + digest.upper()


def chat_row(crm_row):
    result = sent_message(crm_row)
    if result is None:
        return None
    provider, message_id = result
    company = outreach.text_cell(crm_row, 0)
    contact = outreach.text_cell(crm_row, 4)
    if not company or not crm.EMAIL_RE.fullmatch(contact):
        return None
    state = outreach.text_cell(crm_row, 21)
    return [
        message_reference(provider, message_id),
        outreach.text_cell(crm_row, 18),
        "Contacto comercial de " + company,
        contact,
        company,
        "Automatização de processos - TimeSaver",
        "Proposta comercial enviada",
        "Contacto pontual",
        "Envio outbound registado no CRM (não é pedido do cliente)",
        "Não especificadas",
        "Fornecedor: " + provider + "; ID: " + message_id
            + "; Estado CRM: " + state
            + "; registo operacional em 'Pedidos'.",
        "",
        "",
        "Email aceite pela API do fornecedor. O corpo exato não está arquivado "
            "nesta folha; consultar a mensagem original através do ID. "
            "Aceitação não comprova entrega ou leitura.",
        "Enviado confirmado pela API " + provider + " - " + state,
    ]


def read_chat(credentials, http=requests):
    url = crm.API + "/values/" + quote("'Pedidos chat'!A1:O1000", safe="")
    response = http.get(
        url, headers={"Authorization": "Bearer " + credentials.token},
        timeout=30)
    response.raise_for_status()
    values = response.json().get("values", [])
    if not values or values[0][:15] != CHAT_HEADERS:
        raise RuntimeError("Cabeçalhos inesperados na aba Pedidos chat")
    if len(values) >= MAX_CHAT_ROWS:
        raise RuntimeError("Pedidos chat atingiu limite seguro de linhas")
    return values[1:]


def new_records(crm_rows, chat_rows):
    existing = {str(row[0]).strip() for row in chat_rows if row}
    pending = []
    for source in crm_rows:
        row = chat_row(source)
        if row and row[0] not in existing:
            pending.append(row)
            existing.add(row[0])
    return pending


def append_chat(credentials, rows, http=requests):
    if not rows:
        return 0
    if len(rows) > 30 or any(len(row) != len(CHAT_HEADERS) for row in rows):
        raise ValueError("Lote inválido para Pedidos chat")
    url = crm.API + "/values/" + quote("'Pedidos chat'!A:O", safe="") + ":append"
    response = http.post(
        url,
        params={"valueInputOption": "RAW", "insertDataOption": "INSERT_ROWS"},
        headers={"Authorization": "Bearer " + credentials.token,
                 "Content-Type": "application/json"},
        json={"majorDimension": "ROWS", "values": rows},
        timeout=30,
    )
    response.raise_for_status()
    if response.json().get("updates", {}).get("updatedRows") != len(rows):
        raise RuntimeError("Escrita de envios não confirmada em Pedidos chat")
    return len(rows)


def sync(credentials, *, dry_run=True, http=requests):
    source = outreach.read_crm(credentials, http)
    target = read_chat(credentials, http)
    pending = new_records(source, target)
    print(f"Registos de email a espelhar em 'Pedidos chat': {len(pending)}; "
          f"simulação={dry_run}", flush=True)
    if dry_run:
        return {"found": len(pending), "appended": 0}
    if len(pending) > 30:
        raise RuntimeError("Mais de 30 envios pendentes: rever antes de escrever")
    added = append_chat(credentials, pending, http)
    check = read_chat(credentials, http)
    missing = {row[0] for row in pending} - {r[0] for r in check if r}
    if missing:
        raise RuntimeError("Envios espelhados sem confirmação de leitura")
    return {"found": len(pending), "appended": added}


def main():
    mode = os.getenv("CHAT_SENT_SYNC_MODE", "preview")
    if mode not in ("preview", "sync"):
        raise RuntimeError("Modo de espelho desconhecido")
    if mode == "sync":
        required = {
            "GITHUB_REPOSITORY_ID": "1452563434",
            "GITHUB_REPOSITORY": "timesaverautomate/time-saver",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_WORKFLOW_REF":
                "timesaverautomate/time-saver/.github/workflows/sync-chat-emails.yml@refs/heads/main",
        }
        if any(os.getenv(k) != v for k, v in required.items()) or (
            os.getenv("GITHUB_EVENT_NAME") != "schedule"
            and not (os.getenv("GITHUB_EVENT_NAME") == "workflow_dispatch"
                     and os.getenv("CHAT_SENT_CONFIRM") == "SINCRONIZAR")
        ):
            raise RuntimeError("Escrita em Pedidos chat fora de execução autorizada")
    print(sync(crm.google_credentials(), dry_run=(mode == "preview")))


if __name__ == "__main__":
    main()
