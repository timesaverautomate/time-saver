#!/usr/bin/env python3
"""Pesquisa B2B TimeSaver: pequenas empresas, rotação geográfica e contactos bloqueados."""
import json
import os
import re
import time
import unicodedata
from datetime import datetime, date
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit, quote

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

SID = "1VYEBWJb_9cYGbO8nZa3d_qh1rLUH-H3xf-w4CnOLMS4"
API = f"https://sheets.googleapis.com/v4/spreadsheets/{SID}"
# Zonas de pesquisa: os raios são aproximados e não substituem a morada real.
# Prioridade a bairros/subúrbios onde há menos concorrência de abordagens B2B.
# Formato: (nome da zona, latitude, longitude, raio em metros).
PORTO_SUBURBS = [
    ("Matosinhos", 41.1835, -8.6891, 2600),
    ("Leça da Palmeira", 41.1913, -8.7007, 2300),
    ("Senhora da Hora", 41.1864, -8.6510, 2300),
    ("São Mamede de Infesta", 41.2018, -8.6029, 2400),
    ("Maia", 41.2357, -8.6199, 2800),
    ("Águas Santas", 41.2119, -8.5750, 2300),
    ("Ermesinde", 41.2161, -8.5541, 2600),
    ("Valongo", 41.1880, -8.4987, 2700),
    ("Rio Tinto", 41.1786, -8.5602, 2500),
    ("Gondomar", 41.1433, -8.5331, 2600),
    ("Vila Nova de Gaia", 41.1336, -8.6174, 2700),
    ("Canidelo", 41.1256, -8.6504, 2400),
    ("Espinho", 41.0072, -8.6410, 2700),
    ("Trofa", 41.3382, -8.5607, 2800),
    ("Santo Tirso", 41.3429, -8.4775, 2700),
    ("Vila do Conde", 41.3533, -8.7436, 2500),
    ("Póvoa de Varzim", 41.3827, -8.7627, 2600),
]
LISBON_SUBURBS = [
    ("Amadora", 38.7536, -9.2302, 2500),
    ("Odivelas", 38.7927, -9.1838, 2500),
    ("Loures", 38.8318, -9.1688, 2500),
    ("Sacavém", 38.7920, -9.1052, 2200),
    ("Algés", 38.7027, -9.2298, 2300),
    ("Carnaxide", 38.7274, -9.2416, 2200),
    ("Oeiras", 38.6910, -9.3104, 2800),
    ("Queluz", 38.7565, -9.2544, 2300),
    ("Agualva-Cacém", 38.7701, -9.2980, 2600),
    ("Sintra", 38.8029, -9.3817, 2700),
    ("Cascais", 38.6979, -9.4215, 2700),
    ("Almada", 38.6790, -9.1581, 2600),
    ("Seixal", 38.6418, -9.1026, 2600),
    ("Barreiro", 38.6640, -9.0724, 2600),
]
REGIONAL_TOWNS = [
    ("Braga", 41.5454, -8.4265, 2400),
    ("Vila Verde", 41.6488, -8.4378, 2600),
    ("Vila Nova de Famalicão", 41.4079, -8.5198, 2800),
    ("Guimarães", 41.4444, -8.2962, 2600),
    ("Barcelos", 41.5317, -8.6184, 2600),
    ("Aveiro", 40.6405, -8.6538, 2400),
    ("Ílhavo", 40.5994, -8.6680, 2500),
    ("Águeda", 40.5772, -8.4444, 2600),
    ("Santa Maria da Feira", 40.9276, -8.5428, 2700),
    ("Oliveira de Azeméis", 40.8410, -8.4772, 2600),
    ("Coimbra", 40.2033, -8.4103, 2400),
    ("Figueira da Foz", 40.1509, -8.8618, 2600),
    ("Leiria", 39.7436, -8.8071, 2700),
    ("Viseu", 40.6610, -7.9097, 2700),
    ("Setúbal", 38.5244, -8.8882, 2600),
    ("Faro", 37.0194, -7.9304, 2400),
]
CITY_CENTRES = [
    ("Porto", 41.1579, -8.6291, 1900),
    ("Lisboa", 38.7223, -9.1393, 1900),
]
MAX_SEARCH_ZONES = 8
MAX_PER_ZONE = 5


def rotated(pool, offset, count):
    """Escolha circular e determinística, sem favorecer as primeiras localidades."""
    start = offset % len(pool)
    return [pool[(start + index) % len(pool)] for index in range(count)]


def search_plan(day=None):
    """7/8 das pesquisas fora dos centros Porto/Lisboa, com rotação diária."""
    current = date.fromisoformat(day or today_lisbon())
    ordinal = current.toordinal()
    parts = [
        ("suburbio", rotated(PORTO_SUBURBS, ordinal * 3, 3)),
        ("suburbio", rotated(LISBON_SUBURBS, ordinal * 2, 2)),
        ("regional", rotated(REGIONAL_TOWNS, ordinal * 2, 2)),
        ("centro", rotated(CITY_CENTRES, ordinal, 1)),
    ]
    plan = [(name, lat, lon, radius, kind)
            for kind, locations in parts
            for name, lat, lon, radius in locations]
    assert len(plan) == MAX_SEARCH_ZONES
    return plan


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
MAX_DAILY_WRITES = 15
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



def review_signals(email, website):
    """Triagem documental, não prova de propriedade, entrega ou consentimento."""
    host = domain(website)
    email_domain = email.rsplit("@", 1)[-1].lower() if "@" in email else ""
    if not host:
        return "REVER: sem website oficial identificado; confirmar email e empresa"
    if email_domain != host:
        return "REVER: domínio do email diferente do website; confirmar associação"
    return "REVER: domínio do email coincide com website; confirmar atualidade e legitimidade"



def candidate(element, city, zone_type="centro"):
    """Recolhe apenas caixas genéricas, sem inferir dimensão nem legitimidade legal."""
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
    # Não inventar o município: uma pesquisa radial pode atravessar concelhos.
    municipality = str(tags.get("addr:city") or "").strip()
    row[2] = (municipality[:100] if municipality else
              f"Área de {city} (aproximada)" if zone_type != "centro" else city)
    row[3] = website[:400] if domain(website) else ""
    row[4] = email
    row[5] = str(tags.get("phone") or tags.get("contact:phone") or "")[:80]
    row[7] = "Hipótese a investigar; necessidades internas não verificadas"
    row[9] = "Por contactar"
    row[11] = "Confirmar dimensão, morada, empresa, contacto e fundamento legal"
    row[15] = f"https://www.openstreetmap.org/{osm_type}/{osm_id}"
    brand = str(tags.get("brand") or "").strip()
    row[16] = (
        f"OSM público; dados não verificados; ZONA_PESQUISA={city}; "
        f"TIPO_ZONA={zone_type}; "
        + ("Município não confirmado; " if not municipality else "")
        + ("Marca referida no OSM (rever se é cadeia); " if brand else "")
        + review_signals(email, row[3])
    )
    row[23] = "Por avaliar"
    row[24] = "Sim"  # Sem desbloqueio automático de prospeção.
    row[25] = f"osm:{osm_type}:{osm_id}"
    score = prospect_score(row)
    row[8] = "Alta" if score >= 65 else "Média" if score >= 40 else "Baixa"
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
        (bool(name and city) and (name, city) in names) or
        (bool(email) and email in emails) or
        (bool(website_domain) and website_domain in domains) or
        (bool(source) and source in sources)
    )


def mark_seen(row, keys):
    name, city, email, website_domain, source = identity(row)
    names, emails, domains, sources = keys
    if name and city:
        names.add((name, city))
    if email:
        emails.add(email)
    if website_domain:
        domains.add(website_domain)
    if source:
        sources.add(source)


def validate_mode(mode, env):
    if mode not in ("simular", "simular_resend", "teste_escrita_2", "diario"):
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



REVIEW_HEADERS = [
    "Empresa", "Setor", "Localidade", "Website", "Email comercial",
    "Prioridade", "Fonte pública", "Triagem automática", "Estado de revisão",
    "Base legal / autorização", "Observações da revisão", "Linha CRM",
]



def prospect_score(row):
    """0-100, exclusivamente sinais observáveis; NUNCA autoriza contacto.

    Dimensão desconhecida vale 0 pontos nesse critério, não significa empresa grande.
    Os valores adicionais DIMENSAO_VERIFICADA e PROCESSO_VALIDADO são revisão humana.
    """
    sector = norm(row[1] if len(row) > 1 else "")
    website = str(row[3]) if len(row) > 3 else ""
    email = str(row[4]).strip().lower() if len(row) > 4 else ""
    notes = str(row[16]) if len(row) > 16 else ""
    score = 0
    # Adequação a serviços que conseguimos entregar.
    if sector in {"accountant", "estate_agent", "wholesale", "trade"} or any(
        word in sector for word in ("contab", "imobili", "distribu")
    ):
        score += 35
    elif sector in {"consulting", "insurance", "logistics", "company"}:
        score += 25
    elif sector in {"office_supplies", "hardware", "computer", "electronics"}:
        score += 15
    else:
        score += 5
    # Preferência por zonas menos saturadas; nunca afirmar que a empresa é pequena.
    if "TIPO_ZONA=suburbio" in notes:
        score += 25
    elif "TIPO_ZONA=regional" in notes:
        score += 20
    elif "TIPO_ZONA=centro" in notes:
        score += 5
    # Contacto técnico observável; não substitui a verificação da titularidade.
    if EMAIL_RE.fullmatch(email):
        email_domain = email.rsplit("@", 1)[-1]
        if domain(website) and email_domain == domain(website):
            score += 20
        elif domain(website):
            score += 5
    # Evidência adicional só após verificação explícita (nunca deduzida do setor).
    size = re.search(r"\bDIMENSAO_VERIFICADA=(\d{1,5})\b", notes)
    if size:
        employees = int(size.group(1))
        if 1 <= employees <= 20:
            score += 15
        elif employees <= 50:
            score += 8
    if "PROCESSO_VALIDADO=Sim" in notes:
        score += 5
    # Marca/franquia não prova grande dimensão, mas pede análise adicional.
    if "Marca referida no OSM" in notes:
        score -= 10
    return max(0, min(100, score))


def proposal_content(row):
    """Email comercial base aprovado, com exemplos concretos e sem envio."""
    name = str(row[0]).strip()[:80] if row else ""
    subject = "TimeSaver | Poupe tempo e reduza custos com automação"
    greeting = "Bom dia," if not name else f"Bom dia, equipa {name},"
    body = (
        greeting + "\n\n"
        "Somos a TimeSaver, uma empresa especializada na automatização de processos empresariais.\n\n"
        "Ajudamos empresas a reduzir o tempo gasto em tarefas repetitivas, como:\n\n"
        "- Receção, organização e tratamento automático de faturas;\n"
        "- Organização e gestão de emails através de regras e automatizações;\n"
        "- Reconciliações e atualização automática de ficheiros Excel;\n"
        "- Elaboração de relatórios e tratamento de documentos;\n"
        "- Entre outros processos administrativos.\n\n"
        "O nosso objetivo é simples: poupar tempo, reduzir custos e libertar a equipa "
        "para tarefas de maior valor.\n\n"
        "Gostaríamos de perceber se existem processos na vossa empresa que possam "
        "ser simplificados ou automatizados.\n\n"
        "Teriam disponibilidade para uma breve reunião, sem compromisso, "
        "para explorarmos possíveis oportunidades?\n\n"
        "Em alternativa, podem visitar o nosso site e solicitar diretamente um "
        "orçamento, sem compromisso:\n\n"
        "https://timesaverautomate.com\n\n"
        "Cumprimentos,\nEquipa TimeSaver"
    )
    return subject, body


def draft_proposal(row):
    """Rascunho interno; nunca envia mensagens."""
    subject, body = proposal_content(row)
    return "RASCUNHO NÃO ENVIADO — Assunto: " + subject + "\n" + body



SEND_ELIGIBILITY_LABEL = "Elegível para envio"
VALID_LEGAL_BASES = {"Consentimento documentado", "Pessoa coletiva - fundamento validado"}


def evaluate_send_eligibility(crm_row, review_row, suppressed_emails=()):
    """Fail closed: critérios técnicos e base legal explícita, nunca apenas score."""
    def value(row, index):
        return str(row[index]).strip() if len(row) > index else ""
    email = value(crm_row, 4).lower()
    website = value(crm_row, 3)
    if value(crm_row, 24).casefold() == "sim":
        return False, "Bloqueio Não contactar no CRM"
    if value(review_row, 8) != "Verificado":
        return False, "Revisão não concluída"
    if value(review_row, 9) not in VALID_LEGAL_BASES:
        return False, "Base legal não documentada"
    if not EMAIL_RE.fullmatch(email):
        return False, "Email inválido"
    local, email_domain = email.rsplit("@", 1)
    if email in {str(e).lower() for e in suppressed_emails}:
        return False, "Oposição ou supressão"
    if local not in GENERIC_LOCAL_PARTS or email_domain in FREE_EMAIL_DOMAINS:
        return False, "Contacto não é caixa empresarial genérica"
    if not domain(website) or domain(website) != email_domain:
        return False, "Domínio da empresa não confirmado"
    if value(crm_row, 20) not in ("", "0"):
        return False, "Contacto já abordado"
    if value(crm_row, 21) in ("Bounce", "Cancelou subscrição", "Erro"):
        return False, "Estado Resend impede contacto"
    return True, SEND_ELIGIBILITY_LABEL



def review_row(crm_row, line_number):
    def cell(index):
        return str(crm_row[index]) if len(crm_row) > index else ""
    return [
        cell(0), cell(1), cell(2), cell(3), cell(4), cell(8), cell(15),
        ("Sem email confirmado" if not cell(4) else
         "Sem website identificado" if not domain(cell(3)) else
         "Domínio coincide (não verificado)" if cell(4).rsplit("@", 1)[-1].lower() == domain(cell(3))
         else "Domínios diferentes (rever)"),
        "Por verificar", "", f"Score comercial: {prospect_score(crm_row)}/100 (sem validar dimensão); " + draft_proposal(crm_row), str(line_number),
    ]




def build_resend_preview(row):
    """Representação local do email; nunca chama a API Resend."""
    subject, body = proposal_content(row)
    return {
        "to": str(row[4]).strip().lower(),
        "subject": subject,
        "text": body,
        "status": "SIMULADO — NÃO ENVIADO",
    }




def suppression_index(crm_rows):
    """Reutiliza oposições e falhas registadas no CRM em todas as linhas."""
    suppressed = set()
    for row in crm_rows:
        email = str(row[4]).strip().lower() if len(row) > 4 else ""
        if not email:
            continue
        contact_block = str(row[24]).strip().casefold() if len(row) > 24 else ""
        delivery = norm(row[21]) if len(row) > 21 else ""
        if contact_block == "sim" or delivery in (
            "bounce", "cancelou subscricao", "erro", "complaint", "spam"
        ):
            suppressed.add(email)
    return suppressed


def unique_send_candidates(rows):
    """Um único destinatário por execução, independentemente do número de empresas."""
    seen = set()
    unique = []
    for score, row in sorted(rows, key=lambda pair: pair[0], reverse=True):
        email = str(row[4]).strip().lower()
        if email in seen:
            continue
        seen.add(email)
        unique.append((score, row))
    return unique



def simulate_resend(credentials, crm_rows, limit=30):
    """Simulação integral de elegibilidade e payload Resend; sem chamadas à Resend."""
    response = requests.get(
        f"{API}/values/{quote(chr(39) + 'Revisão Comercial' + chr(39) + '!A1:L10000', safe='')}",
        headers={"Authorization": "Bearer " + credentials.token},
        timeout=30,
    )
    response.raise_for_status()
    values = response.json().get("values", [])
    if not values or values[0] != REVIEW_HEADERS:
        raise RuntimeError("Cabeçalhos de revisão inválidos: simulação interrompida.")
    review_by_line = {str(r[11]).strip(): r for r in values[1:] if len(r) > 11}
    blocked = {}
    eligible = []
    suppressed = suppression_index(crm_rows)
    for line, crm_row in enumerate(crm_rows, start=2):
        if not crm_row or not crm_row[0]:
            continue
        review = review_by_line.get(str(line))
        if not review or norm(review[0]) != norm(crm_row[0]):
            reason = "Revisão ausente ou não corresponde ao CRM"
            allowed = False
        else:
            allowed, reason = evaluate_send_eligibility(crm_row, review, suppressed)
        if not allowed:
            blocked[reason] = blocked.get(reason, 0) + 1
            continue
        eligible.append((prospect_score(crm_row), crm_row))
    selected = unique_send_candidates(eligible)[:limit]
    print(f"SIMULAÇÃO RESEND: {len(crm_rows)} empresas; {len(eligible)} elegíveis; {len(selected)} selecionadas; 0 envios.")
    for reason, count in sorted(blocked.items()):
        print(f"Bloqueados — {reason}: {count}")
    for score, row in selected:
        # Preview sem expor emails nos logs de execução.
        preview = build_resend_preview(row)
        print(f"Proposta simulada: score={score}; setor={str(row[1])[:70]}; assunto={preview['subject']}; estado={preview['status']}")
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(
                "\\n## TimeSaver — simulação Resend (sem envio)\\n"
                f"- Contactos avaliados: {len(crm_rows)}\\n"
                f"- Elegíveis: {len(eligible)}\\n"
                f"- Selecionados (máximo {limit}): {len(selected)}\\n"
                "- Emails enviados: **0**\\n"
            )
    return {"eligible": len(eligible), "selected": len(selected), "blocked": blocked}



def sync_review(credentials, crm_rows):
    """Só acrescenta linhas em falta; nunca altera estados/decisões existentes."""
    target = quote("'Revisão Comercial'!A1:L10000", safe="")
    response = requests.get(
        f"{API}/values/{target}",
        headers={"Authorization": "Bearer " + credentials.token},
        timeout=30,
    )
    response.raise_for_status()
    values = response.json().get("values", [])
    if not values or values[0] != REVIEW_HEADERS:
        raise RuntimeError("Cabeçalhos da Revisão Comercial alterados; sincronização recusada.")
    existing_lines = {str(r[11]).strip() for r in values[1:] if len(r) > 11 and str(r[11]).strip()}
    existing_names = {(norm(r[0]), norm(r[2])) for r in values[1:] if len(r) > 2 and r[0] and r[2]}
    additions = []
    for line, crm_row in enumerate(crm_rows, start=2):
        if not crm_row or not crm_row[0]:
            continue
        key = (norm(crm_row[0]), norm(crm_row[2] if len(crm_row) > 2 else ""))
        if str(line) in existing_lines or key in existing_names:
            continue
        additions.append(review_row(crm_row, line))
        existing_lines.add(str(line))
        existing_names.add(key)
    if not additions:
        print("Revisão Comercial sincronizada: zero novas linhas.")
        return 0
    result = requests.post(
        f"{API}/values/{quote(chr(39) + 'Revisão Comercial' + chr(39) + '!A:L', safe='')}:append",
        params={"valueInputOption": "RAW", "insertDataOption": "INSERT_ROWS"},
        headers={"Authorization": "Bearer " + credentials.token},
        json={"values": additions},
        timeout=30,
    )
    result.raise_for_status()
    if result.json().get("updates", {}).get("updatedRows") != len(additions):
        raise RuntimeError("Sincronização sem confirmação de escrita; verificar manualmente.")
    print(f"Revisão Comercial: {len(additions)} novas linhas; decisões anteriores preservadas.")
    return len(additions)



def balanced_candidates(groups, limit):
    """Distribui o resultado por zonas, em vez de encher o CRM na primeira cidade."""
    selected = []
    for position in range(max((len(group) for group in groups), default=0)):
        for group in groups:
            if position < len(group):
                selected.append(group[position])
                if len(selected) >= limit:
                    return selected
    return selected


def find_candidates(existing, limit, day=None):
    seen = existing_keys(existing)
    groups = []
    successful, failed = 0, 0
    plan = search_plan(day)
    print("Plano de pesquisa: " + "; ".join(
        f"{name} ({kind})" for name, _, _, _, kind in plan
    ), flush=True)
    for city, lat, lon, radius, kind in plan:
        query = (
            '[out:json][timeout:35];('
            f'nwr(around:{radius},{lat},{lon})'
            '["office"~"^(accountant|estate_agent|consulting|insurance|company|logistics)$"]["name"];'
            f'nwr(around:{radius},{lat},{lon})'
            '["shop"~"^(wholesale|trade|office_supplies|computer|hardware|electronics|pet)$"]["name"];'
            ');out tags 250;'
        )
        elements = None
        for endpoint in ENDPOINTS:
            try:
                response = requests.post(
                    endpoint, data={"data": query},
                    headers={"User-Agent": "TimeSaverAutomation/1.2 (small business research; timesaverautomate.com)"},
                    timeout=(10, 45),
                )
                if response.status_code != 200:
                    print(f"Fonte {endpoint}; zona {city}; HTTP {response.status_code}", flush=True)
                    continue
                data = response.json()
                if not isinstance(data.get("elements"), list):
                    print(f"Resposta inesperada da fonte em {city}", flush=True)
                    continue
                elements = data["elements"]
                successful += 1
                break
            except (requests.RequestException, ValueError) as exc:
                print(f"Fonte {endpoint}; zona {city}; erro {type(exc).__name__}", flush=True)
        if elements is None:
            failed += 1
            groups.append([])
            print(f"Todas as fontes indisponíveis em {city}", flush=True)
            continue
        local = []
        for element in elements:
            row = candidate(element, city, kind)
            if row is not None and not is_duplicate(row, seen):
                local.append(row)
        # A fonte não devolve os elementos por potencial comercial.
        local.sort(key=prospect_score, reverse=True)
        group = []
        for row in local:
            if is_duplicate(row, seen):
                continue
            group.append(row)
            mark_seen(row, seen)
            if len(group) >= MAX_PER_ZONE:
                break
        groups.append(group)
        print(f"Zona {city}: {len(group)} candidatos novos para triagem.", flush=True)
        time.sleep(1)
    candidates = balanced_candidates(groups, limit)
    print(f"Consultas com sucesso: {successful}; falhas: {failed}", flush=True)
    print(f"Candidatos encontrados (diversidade geográfica): {len(candidates)}", flush=True)
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
            row[16] = str(row[16]) + "; " + AUTO_MARKER + day
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
        "- Contactos novos: **bloqueados até comprovação de elegibilidade legal**",
    ]
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")



def main():
    mode = validate_mode(os.environ.get("CRM_MODE", "simular"), os.environ)
    credentials = google_credentials()
    existing = read_rows(credentials)
    day = today_lisbon()
    print(f"CRM consultado: {len(existing)} empresas. Modo: {mode}.", flush=True)
    if mode == "simular_resend":
        simulate_resend(credentials, existing)
        return
    if mode in ("diario", "teste_escrita_2"):
        sync_review(credentials, existing)
    if mode == "diario":
        remaining = daily_remaining(existing, day)
        print(f"Quota automática {day}: {MAX_DAILY_WRITES - remaining}/{MAX_DAILY_WRITES} usadas.")
        if remaining == 0:
            print("Quota esgotada; zero escritas e nenhum email.")
            publish_summary(mode, len(existing), 0, 0, "Quota diária atingida")
            return
        candidates = find_candidates(existing, remaining, day=day)
        written = write_candidates(credentials, candidates, remaining, mode, day=day)
        sync_review(credentials, read_rows(credentials))
        publish_summary(mode, len(existing), len(candidates), written)
    elif mode == "teste_escrita_2":
        candidates = find_candidates(existing, MAX_TEST_WRITES, day=day)
        written = write_candidates(credentials, candidates, MAX_TEST_WRITES, mode)
        sync_review(credentials, read_rows(credentials))
        publish_summary(mode, len(existing), len(candidates), written)
    else:
        candidates = find_candidates(existing, MAX_DAILY_WRITES, day=day)
        print("SIMULAÇÃO: nenhuma escrita e nenhum envio de email.")
        publish_summary(mode, len(existing), len(candidates), 0)


if __name__ == "__main__":
    main()
