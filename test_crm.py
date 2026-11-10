
import json
import os
import urllib.request
import urllib.error

from google.auth.transport.requests import Request
from google.oauth2 import service_account

SPREADSHEET_ID = "1VYEBWJb_9cYGbO8nZa3d_qh1rLUH-H3xf-w4CnOLMS4"

def main():
    raw_credentials = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    info = json.loads(raw_credentials)

    credentials = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    credentials.refresh(Request())

    url = (
        "https://sheets.googleapis.com/v4/spreadsheets/"
        + SPREADSHEET_ID
        + "/values/Empresas%21A1%3AC3"
    )

    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {credentials.token}"},
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)

    print("Ligação ao CRM efetuada com sucesso!")
    print("Intervalo consultado:", data.get("range"))
    print("Número de linhas devolvidas:", len(data.get("values", [])))
    print("Não foram enviados emails nem alterados dados.")

if __name__ == "__main__":
    main()
