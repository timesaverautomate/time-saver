#!/usr/bin/env python3
"""Teste manual e único: Resend -> CRM, apenas para caixa interna TimeSaver."""
import json
import os
import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request
from urllib.parse import quote

TO = "timesaverautomate@gmail.com"
SID = "1VYEBWJb_9cYGbO8nZa3d_qh1rLUH-H3xf-w4CnOLMS4"
API = f"https://sheets.googleapis.com/v4/spreadsheets/{SID}/values/"
MARKER = "TS_RESEND_TEST_" + os.environ["GITHUB_RUN_ID"]
HEADERS = ("Empresa", "Email comercial", "ID mensagem Resend", "Não contactar")

def main():
    if (os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or
        os.environ.get("GITHUB_REPOSITORY") != "timesaverautomate/time-saver" or
        os.environ.get("GITHUB_REF") != "refs/heads/main" or
        os.environ.get("TEST_RECIPIENT") != TO):
        raise RuntimeError("Teste não autorizado")
    raw = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    credentials = service_account.Credentials.from_service_account_info(
        raw, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    credentials.refresh(Request())
    headers = {"Authorization": "Bearer " + credentials.token}
    def read():
        response = requests.get(API + quote("'Pedidos'!A1:Z10000", safe=""),
                                headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()["values"]
    rows = read()
    if not rows or any(rows[0][i] != name for i, name in ((0, HEADERS[0]), (4, HEADERS[1]), (22, HEADERS[2]), (24, HEADERS[3]))):
        raise RuntimeError("Cabeçalhos CRM inválidos")
    matches = [(i, r) for i, r in enumerate(rows, 1) if len(r) > 25 and r[25] == MARKER]
    if len(matches) > 1:
        raise RuntimeError("Marcador duplicado; intervenção necessária")
    if matches:
        rownum, row = matches[0]
        if len(row) > 22 and row[22]:
            print("Teste já registado no CRM; sem novo envio")
            return
    else:
        testrow = [""] * 26
        testrow[0] = "TESTE INTERNO Resend TimeSaver"
        testrow[4] = TO
        testrow[9] = "Teste interno"
        testrow[16] = "Teste técnico controlado; não contactar clientes"
        testrow[23] = "Teste interno"
        testrow[24] = "Sim"
        testrow[25] = MARKER
        response = requests.post(API + quote("'Pedidos'!A:Z", safe="") + ":append",
                                 params={"valueInputOption": "RAW", "insertDataOption": "INSERT_ROWS"},
                                 headers=headers, json={"values": [testrow]}, timeout=30)
        response.raise_for_status()
        rows = read()
        matches = [(i, r) for i, r in enumerate(rows, 1) if len(r) > 25 and r[25] == MARKER]
        if len(matches) != 1:
            raise RuntimeError("Linha de teste não confirmada; não enviar")
        rownum, row = matches[0]
    key = os.environ["RESEND_API_KEY"]
    if not key.startswith("re_"):
        raise RuntimeError("Chave Resend não configurada")
    from_address = os.environ["TEST_MAIL_FROM"]
    if not from_address.endswith("@timesaverautomate.com"):
        raise RuntimeError("Remetente não é domínio TimeSaver")
    response = requests.post("https://api.resend.com/emails",
        headers={"Authorization": "Bearer " + key,
                 "Idempotency-Key": MARKER, "Content-Type": "application/json"},
        json={"from": from_address, "to": [TO],
              "subject": "TimeSaver — teste interno Resend e CRM",
              "text": "Teste interno de integração. Nenhuma empresa foi contactada. Referência: " + MARKER},
        timeout=20)
    response.raise_for_status()
    resend_id = response.json().get("id")
    if not isinstance(resend_id, str) or not resend_id:
        raise RuntimeError("Resend não devolveu ID")
    # Releitura antes de escrever; esta rotina é exclusiva do teste interno bloqueado.
    rows = read()
    if (len(rows) < rownum or len(rows[rownum-1]) < 26 or
        rows[rownum-1][25] != MARKER or rows[rownum-1][4].lower() != TO or
        rows[rownum-1][24] != "Sim" or
        (len(rows[rownum-1]) > 22 and rows[rownum-1][22] not in ("", resend_id))):
        raise RuntimeError("Linha alterada: não escrever ID; rever execução")
    if len(rows[rownum-1]) > 22 and rows[rownum-1][22] == resend_id:
        print("ID já registado; teste concluído")
        return
    response = requests.put(API + quote(f"'Pedidos'!W{rownum}", safe=""),
        params={"valueInputOption": "RAW"}, headers=headers,
        json={"values": [[resend_id]]}, timeout=30)
    response.raise_for_status()
    if response.json().get("updatedCells") != 1:
        raise RuntimeError("Escrita do ID não confirmada")
    verified = read()
    if verified[rownum-1][22] != resend_id:
        raise RuntimeError("ID não confirmado na releitura")
    print(f"Teste confirmado: linha {rownum}; ID Resend guardado na coluna W.")
    print("O estado de entrega será atualizado pelo webhook de forma assíncrona.")

if __name__ == "__main__":
    main()
