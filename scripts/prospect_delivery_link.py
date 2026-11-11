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
