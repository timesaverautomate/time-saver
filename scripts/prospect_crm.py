#!/usr/bin/env python3
"""Pesquisa B2B TimeSaver: simulação por defeito; escrita manual de até 2 registos."""
import json
import os
import re
import time
import unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit, quote

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

SID = "1VYEBWJb_9cYGbO8nZa3d_qh1rLUH-H3xf-w4CnOLMS4"
API = f"https://sheets.googleapis.com/v4/spreadsheets/{SID}"
CITIES = [
    ("Porto", 41.1579, -8.6291),
    ("Lisboa", 38.7223, -9.1393),
    ("Braga", 41.5454, -8.4265),
    ("Coimbra", 40.2033, -8.4103),
    ("Aveiro", 40.6405, -8.6538),
    ("Faro", 37.0194, -7.9304),
]
ENDPOINTS = (
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
HEADERS = [
    "Empresa", "Setor", "Localidade", "Website", "Email comercial", "Telefone",
    "Responsável", "Oportunidade a investigar", "Prioridade", "Estado",
    "Último contacto", "Próxima ação", "Data próxima ação",
    "Responsável TimeSaver", "Valor proposta (€)", "Fonte pública", "Notas",
    "Data 1.º envio", "Data último envio", "Data follow-up",
    "N.º emails enviados", "Estado email Resend", "ID mensagem Resend",
    "Consentimento/base legal", "Não contactar", "Chave duplicado",
]
GENERIC_LOCAL_PARTS = {
    "info", "geral", "contacto", "comercial", "office", "hello",
    "sales", "contact", "admin",
}
EMAIL_RE = re.compile(r"^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$", re.I)
MAX_TEST_WRITES = 2
MAX_DAILY_WRITES = 30
DAILY_WRITE_APPROVED_IN_CODE = True  # Recolha diaria autorizada; emails permanecem bloqueados
AUTO_MARKER = 'TSCRM_AUTO_DATE='
FREE_EMAIL_DOMAINS = {'gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'icloud.com', 'proton.me'}


def norm(value):
    raw = unicodedata.normalize("NFKD", str(value or "").casefold())
    return "".join(c for c in raw if not unicodedata.combining(c)).strip()


def domain(url):
    if not url or not str(url).startswith(("http://", "https://")):
        return ""
    hostname = (urlsplit(str(url)).hostname or "").lower().removeprefix("www.")
    return hostname if "." in hostname else ""


def candidate(element, city):
    tags = element.get("tags") or {}
    name = str(tags.get("name") or "").strip()
    email = str(tags.get("contact:email") or tags.get("email") or "").split(";")[0].strip().lower()
    if (not name or not EMAIL_RE.fullmatch(email) or
            email.split("@")[0] not in GENERIC_LOCAL_PARTS or
            email.split("@")[1] in FREE_EMAIL_DOMAINS):
        return None
    osm_type = element.get("type")
    osm_id = element.get("id")
    if osm_type not in ("node", "way", "relation") or not isinstance(osm_id, int) or osm_id <= 0:
        return None
    row = [""] * len(HEADERS)
    website = str(tags.get("website") or tags.get("contact:website") or "").strip()
    row[0] = name[:180]
    row[1] = str(tags.get("shop") or tags.get("office") or "Empresa")[:70]
    row[2] = city
    row[3] = website[:400] if domain(website) else ""
    row[4] = email
    row[5] = str(tags.get("phone") or tags.get("contact:phone") or "")[:80]
    row[7] = "Hipótese de automação a investigar"
    row[8] = "Por avaliar"
    row[9] = "Por contactar"
    row[11] = "Rever empresa e email antes de qualquer contacto"
    row[15] = f"https://www.openstreetmap.org/{osm_type}/{osm_id}"
    row[16] = "OSM público; dados não verificados; inserção de teste"
    row[23] = "Por avaliar"
    row[24] = "Sim"  # Bloqueio explícito de contacto até revisão.
    row[25] = f"osm:{osm_type}:{osm_id}"
    return row


def identity(row):
    return (
        norm(row[0]) if len(row) > 0 else "",
        norm(row[2]) if len(row) > 2 else "",
        norm(row[4]) if len(row) > 4 else "",
        domain(row[3]) if len(row) > 3 else "",
        norm(row[25]) if len(row) > 25 else "",
    )


def existing_keys(rows):
    names, emails, domains, sources = set(), set(), set(), set()
    for row in rows:
        name, city, email, website_domain, source = identity(row)
        if name and city:
            names.add((name, city))
        if email:
            emails.add(email)
        if website_domain:
            domains.add(website_domain)
        if source:
            sources.add(source)
    return names, emails, domains, sources


def is_duplicate(row, keys):
    name, city, email, website_domain, source = identity(row)
    names, emails, domains, sources = keys
    return (
        (name, city) in names or email in emails or
        (bool(website_domain) and website_domain in domains) or source in sources
    )


def mark_seen(row, keys):
    name, city, email, website_domain, source = identity(row)
    names, emails, domains, sources = keys
    names.add((name, city))
    emails.add(email)
    if website_domain:
        domains.add(website_domain)
    sources.add(source)


def validate_mode(mode, env):
    if mode not in ("simular", "teste_escrita_2", "diario"):
        raise RuntimeError("Modo desconhecido: escrita recusada.")
    if mode in ("teste_escrita_2", "diario"):
        required = {
            "GITHUB_REPOSITORY_ID": "1452563434",
            "GITHUB_REPOSITORY": "timesaverautomate/time-saver",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_WORKFLOW_REF": (
                "timesaverautomate/time-saver/.github/workflows/"
                "prospect-crm.yml@refs/heads/main"
            ),
            "GITHUB_EVENT_NAME": ("schedule" if mode == "diario" else "workflow_dispatch"),
        }
        if any(env.get(key) != value for key, value in required.items()):
            raise RuntimeError("Repositório ou evento não autorizado: escrita recusada.")
    if mode == "diario" and not DAILY_WRITE_APPROVED_IN_CODE:
        print("ESCRITA DIÁRIA BLOQUEADA: validação operacional pendente.")
        return "simular"
    if mode == "diario" and env.get("CRM_DAILY_WRITE_ENABLED", "").lower() != "true":
        print("ESCRITA DIÁRIA DESATIVADA: apenas simulação.")
        return "simular"
    return mode


def today_lisbon():
    return datetime.now(ZoneInfo("Europe/Lisbon")).date().isoformat()


def count_imports_today(rows, day):
    marker = AUTO_MARKER + day
    return sum(1 for row in rows if len(row) > 16 and marker in str(row[16]))


def daily_remaining(rows, day):
    return max(0, MAX_DAILY_WRITES - count_imports_today(rows, day))


def google_credentials():
    raw = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    credentials = service_account.Credentials.from_service_account_info(
        json.loads(raw), scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    credentials.refresh(Request())
    return credentials


def read_rows(credentials):
    response = requests.get(
        f"{API}/values/{quote(chr(39) + 'Pedidos' + chr(39) + '!A1:Z10000', safe='')}",
        headers={"Authorization": "Bearer " + credentials.token},
        timeout=30,
    )
    if not response.ok:
        try:
            detail = response.json().get("error", {})
            message = detail.get("message", "Sem detalhe da API")
        except ValueError:
            message = "Resposta não JSON da API"
        raise RuntimeError(f"Leitura Google Sheets HTTP {response.status_code}: {message}")
    rows = response.json().get("values", [])
    if not rows or rows[0] != HEADERS:
        raise RuntimeError("Cabeçalhos do CRM alterados: nenhuma escrita autorizada.")
    if len(rows) >= 10000:
        raise RuntimeError("Limite de leitura atingido: escrita recusada.")
    return rows[1:]


def find_candidates(existing, limit):
    seen = existing_keys(existing)
    candidates = []
    successful, failed = 0, 0
    for city, lat, lon in CITIES:
        if len(candidates) >= limit:
            break
        query = (
            '[out:json][timeout:35];('
            f'nwr(around:12000,{lat},{lon})'
            '["shop"~"^(computer|electronics|mobile_phone|office_supplies|hardware|pet|furniture)$"]["name"];'
            f'nwr(around:12000,{lat},{lon})'
            '["office"~"^(accountant|insurance|estate_agent|consulting|company)$"]["name"];'
            ');out tags 350;'
        )
        elements = None
        for endpoint in ENDPOINTS:
            try:
                response = requests.post(
                    endpoint, data={"data": query},
                    headers={"User-Agent": "TimeSaverAutomation/1.1 (business research)"},
                    timeout=(10, 45),
                )
                if response.status_code != 200:
                    print(f"Fonte {endpoint}; cidade {city}; HTTP {response.status_code}", flush=True)
                    continue
                data = response.json()
                if not isinstance(data.get("elements"), list):
                    print(f"Resposta inesperada da fonte em {city}", flush=True)
                    continue
                elements = data["elements"]
                successful += 1
                break
            except (requests.RequestException, ValueError) as exc:
                print(f"Fonte {endpoint}; cidade {city}; erro {type(exc).__name__}", flush=True)
        if elements is None:
            failed += 1
            print(f"Todas as fontes indisponíveis em {city}", flush=True)
            continue
        for element in elements:
            row = candidate(element, city)
            if row is None or is_duplicate(row, seen):
                continue
            candidates.append(row)
            mark_seen(row, seen)
            if len(candidates) >= limit:
                break
        time.sleep(1)
    print(f"Consultas com sucesso: {successful}; falhas: {failed}", flush=True)
    print(f"Candidatos encontrados: {len(candidates)}", flush=True)
    if successful == 0:
        raise RuntimeError("Todas as consultas falharam. Nenhum contacto foi guardado.")
    return candidates


def prepare_rows_for_write(latest, candidates, limit, day=None):
    """Revalidar duplicados, bloqueios e quota antes de qualquer escrita."""
    if day:
        limit = min(limit, daily_remaining(latest, day))
    if limit <= 0:
        return []
    keys = existing_keys(latest)
    fresh = []
    for source in candidates:
        row = list(source)
        if is_duplicate(row, keys):
            continue
        if len(row) != 26 or row[24] != "Sim" or row[23] != "Por avaliar":
            raise RuntimeError("Proteções de contacto em falta: escrita recusada.")
        if any(row[i] for i in range(17, 23)):
            raise RuntimeError("Campos de email devem permanecer vazios.")
        if day:
            row[16] = "OSM público; dados por verificar; " + AUTO_MARKER + day
        fresh.append(row)
        mark_seen(row, keys)
        if len(fresh) >= limit:
            break
    return fresh


def write_candidates(credentials, candidates, limit, mode, day=None):
    if not candidates:
        if mode == "diario":
            print("Sem novos candidatos elegíveis. Zero escritas.")
            return 0
        raise RuntimeError("Nenhum candidato novo; teste de escrita não executado.")
    latest = read_rows(credentials)
    fresh = prepare_rows_for_write(
        latest, candidates, limit, day if mode == "diario" else None
    )
    if not fresh:
        print("Quota esgotada ou contactos existentes; zero linhas adicionadas.")
        return 0
    response = requests.post(
        f"{API}/values/Pedidos%21A%3AZ:append",
        params={"valueInputOption": "RAW", "insertDataOption": "INSERT_ROWS"},
        headers={"Authorization": "Bearer " + credentials.token},
        json={"values": fresh},
        timeout=30,
    )
    response.raise_for_status()
    count = response.json().get("updates", {}).get("updatedRows")
    if count != len(fresh):
        raise RuntimeError("Sheets não confirmou o total escrito; rever antes de repetir.")
    verified = read_rows(credentials)
    all_sources = [identity(row)[4] for row in verified]
    for row in fresh:
        if all_sources.count(identity(row)[4]) != 1:
            raise RuntimeError("Escrita ocorreu, mas verificação de duplicados falhou.")
    if mode == "diario" and count_imports_today(verified, day) > MAX_DAILY_WRITES:
        raise RuntimeError("Quota diária excedida; investigação necessária.")
    print(f"ESCRITA CONFIRMADA ({mode}): {count} registo(s); Não contactar=Sim.")
    print("Nenhum email enviado.")
    return count



def publish_summary(mode, before, found, written, status="Concluído"):
    """Resumo sem emails ou dados pessoais no separador Summary do GitHub Actions."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    lines = [
        "## TimeSaver — pesquisa B2B",
        f"- Estado: {status}",
        f"- Data (Portugal): {today_lisbon()}",
        f"- Modo: {mode}",
        f"- Empresas já no CRM: {before}",
        f"- Candidatos novos encontrados: {found}",
        f"- Registos adicionados ao CRM: {written}",
        "- Emails enviados: **0**",
        "- Contactos novos: **bloqueados até verificação manual**",
    ]
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")



def main():
    mode = validate_mode(os.environ.get("CRM_MODE", "simular"), os.environ)
    credentials = google_credentials()
    existing = read_rows(credentials)
    day = today_lisbon()
    print(f"CRM consultado: {len(existing)} empresas. Modo: {mode}.", flush=True)
    if mode == "diario":
        remaining = daily_remaining(existing, day)
        print(f"Quota automática {day}: {MAX_DAILY_WRITES - remaining}/{MAX_DAILY_WRITES} usadas.")
        if remaining == 0:
            print("Quota esgotada; zero escritas e nenhum email.")
            publish_summary(mode, len(existing), 0, 0, "Quota diária atingida")
            return
        candidates = find_candidates(existing, remaining)
        written = write_candidates(credentials, candidates, remaining, mode, day=day)
        publish_summary(mode, len(existing), len(candidates), written)
    elif mode == "teste_escrita_2":
        candidates = find_candidates(existing, MAX_TEST_WRITES)
        written = write_candidates(credentials, candidates, MAX_TEST_WRITES, mode)
        publish_summary(mode, len(existing), len(candidates), written)
    else:
        candidates = find_candidates(existing, MAX_DAILY_WRITES)
        print("SIMULAÇÃO: nenhuma escrita e nenhum envio de email.")
        publish_summary(mode, len(existing), len(candidates), 0)


if __name__ == "__main__":
    main()
