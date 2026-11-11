"""Associação segura do ID Resend ao CRM comercial; não envia emails."""
import re

EMAIL_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9-]{5,199}$")

def plan_email_id_update(rows, row_number, recipient, resend_id):
    """Devolve a atualização W da linha verificada ou recusa sem escrever.

    rows inclui o cabeçalho A:Z; row_number é o número real na folha.
    """
    if not isinstance(row_number, int) or row_number < 2 or row_number > len(rows):
        raise ValueError("Linha CRM inválida")
    if not isinstance(resend_id, str) or not EMAIL_ID.fullmatch(resend_id):
        raise ValueError("ID Resend inválido")
    row = rows[row_number - 1]
    email = str(row[4]).strip().casefold() if len(row) > 4 else ""
    if not email or email != str(recipient).strip().casefold():
        raise ValueError("Destinatário não corresponde à linha")
    if len(row) > 24 and str(row[24]).strip().casefold() == "sim":
        raise ValueError("Contacto bloqueado")
    current_id = str(row[22]).strip() if len(row) > 22 else ""
    if current_id:
        if current_id == resend_id:
            return None  # Repetição idempotente
        raise ValueError("A linha já tem outro ID Resend")
    for index, other in enumerate(rows[1:], start=2):
        if index != row_number and len(other) > 22 and str(other[22]).strip() == resend_id:
            raise ValueError("ID Resend já associado a outra linha")
    return {"range": f"'Pedidos'!W{row_number}", "values": [[resend_id]]}

def save_resend_id(credentials, row_number, recipient, resend_id, session=None):
    """Grava W apenas após resposta confirmada do Resend; não envia emails.

    Releitura antes da escrita. Não é uma transação atómica: o chamador
    deve serializar envios e edições concorrentes deste CRM.
    """
    import requests
    from urllib.parse import quote
    sid = "1VYEBWJb_9cYGbO8nZa3d_qh1rLUH-H3xf-w4CnOLMS4"
    api = f"https://sheets.googleapis.com/v4/spreadsheets/{sid}/values/"
    http = session or requests
    headers = {"Authorization": "Bearer " + credentials.token}
    response = http.get(api + quote("'Pedidos'!A1:Z10000", safe=""),
                        headers=headers, timeout=30)
    response.raise_for_status()
    rows = response.json().get("values", [])
    if not rows or len(rows[0]) < 26 or rows[0][22] != "ID mensagem Resend" or rows[0][24] != "Não contactar":
        raise ValueError("Cabeçalhos do CRM não correspondem")
    plan = plan_email_id_update(rows, row_number, recipient, resend_id)
    if plan is None:
        return False
    response = http.put(api + quote(plan["range"], safe=""),
                        params={"valueInputOption": "RAW"},
                        headers={**headers, "Content-Type": "application/json"},
                        json={"values": plan["values"]}, timeout=30)
    response.raise_for_status()
    result = response.json()
    if result.get("updatedCells") != 1:
        raise RuntimeError("Escrita do ID Resend não confirmada")
    return True
