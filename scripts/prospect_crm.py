#!/usr/bin/env python3
"""Pesquisa B2B TimeSaver: pequenas empresas, rotação geográfica e contactos bloqueados."""
import json
import math
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
    # Europa, extrato Geofabrik atualizado diariamente.
    "https://ovp.dresel.systems/api/interpreter",
    # Instância global que permite utilização comercial.
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
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
    row[1] = str(tags.get("shop") or tags.get("office") or tags.get("craft") or "Empresa")[:70]
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
    row[8] = "Alta" if score >= 65 else "Média" if score >= 30 else "Baixa"
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
    "Natureza jurídica", "Consulta DGC (AAAA-MM-DD)",
    "Email confirmado (AAAA-MM-DD)", "Fonte de validação",
    "Autorização de envio", "Gancho comercial verificado",
    "Data aprovação (AAAA-MM-DD)",
]



# A dimensão tem precedência sobre setor, região e qualidade do email.
# Só as anotações revistas com fonte documentada confirmam colaboradores.
SIZE_EVIDENCE = re.compile(r"\bDIMENSAO_VERIFICADA=(\d{1,5})\b")
SIZE_SOURCE = re.compile(r"\bFONTE_DIMENSAO=https?://[^\s;]+")


def verified_employees(row):
    """Número de trabalhadores, apenas quando há marcação E fonte da revisão."""
    notes = str(row[16]) if len(row) > 16 else ""
    count = SIZE_EVIDENCE.search(notes)
    if not count or not SIZE_SOURCE.search(notes):
        return None
    employees = int(count.group(1))
    return employees if employees >= 1 else None


def size_priority(row):
    """0=micro, 1=pequena, 2=dimensão desconhecida, 3=marca/cadeia sem prova.

    None representa empresa de dimensão comprovada >=50: fora da prospeção.
    A ausência de indicação de marca NÃO comprova independência nem dimensão.
    """
    count = verified_employees(row)
    if count is not None:
        if count < 10:
            return 0
        if count < 50:
            return 1
        return None
    notes = str(row[16]) if len(row) > 16 else ""
    return 3 if "Marca referida no OSM" in notes else 2


def sector_priority(row):
    """Grupos de oportunidade, não códigos CAE oficiais."""
    sector = norm(row[1] if len(row) > 1 else "")
    if sector in {"accountant", "estate_agent", "wholesale", "trade"} or any(
        word in sector for word in ("contab", "imobili", "distribu")
    ):
        return 0
    if sector in {
        "consulting", "insurance", "logistics", "company", "lawyer",
        "architect", "employment_agency", "financial", "administrative",
        "building", "carpenter", "electrician", "plumber", "hvac",
        "office_supplies", "computer", "hardware", "electronics", "furniture",
        "car_parts", "stationery", "pet",
    }:
        return 1
    return 2


# A informação CAE não é inferida das categorias OSM: só conta quando
# um humano fornece fonte verificável; os restantes recorrem ao setor OSM.
CAE_EVIDENCE = re.compile(r"\bCAE_VERIFICADO=(\d{5})\b")
CAE_SOURCE = re.compile(r"\bFONTE_CAE=https?://[^\s;]+")
# Fora do foco: administração pública, apostas, famílias empregadoras
# e organizações extraterritoriais. O restante fica elegível para triagem.
EXCLUDED_CAE_PREFIXES = {"84", "92", "97", "98", "99"}
PRIMARY_CAE_PREFIXES = {"46", "68", "69"}
SECONDARY_CAE_PREFIXES = {
    "33", "41", "42", "43", "47", "49", "52", "53",
    "62", "63", "66", "70", "71", "73", "74", "77",
    "78", "79", "80", "81", "82", "85", "86", "95", "96",
}


def verified_cae(row):
    """CAE apenas quando o código e a origem estão ambos documentados."""
    notes = str(row[16]) if len(row) > 16 else ""
    code = CAE_EVIDENCE.search(notes)
    if not code or not CAE_SOURCE.search(notes):
        return None
    return code.group(1)


def cae_priority(row):
    """0=setores alvo, 1=adjacentes, 2=outros; None=exclusão documentada."""
    code = verified_cae(row)
    if not code:
        return sector_priority(row)
    prefix = code[:2]
    if prefix in EXCLUDED_CAE_PREFIXES:
        return None
    if prefix in PRIMARY_CAE_PREFIXES:
        return 0
    if prefix in SECONDARY_CAE_PREFIXES:
        return 1
    return 2


def geography_priority(row):
    notes = str(row[16]) if len(row) > 16 else ""
    if "TIPO_ZONA=suburbio" in notes:
        return 0
    if "TIPO_ZONA=regional" in notes:
        return 1
    return 2


def in_target_segment(row):
    """Não bloquear dimensão/CAE desconhecidos; nunca presumir que são pequenos."""
    return size_priority(row) is not None and cae_priority(row) is not None


def lead_priority_key(row):
    """Ordenação: dimensão > cidade/zona > CAE/setor > consistência de contacto.

    O CAE verificado substitui a categoria OSM; em caso de desconhecimento,
    esta serve só como sinal inicial, não como CAE oficial.
    """
    size = size_priority(row)
    cae = cae_priority(row)
    if size is None or cae is None:
        return (99, 99, 99, 99)
    website = str(row[3]) if len(row) > 3 else ""
    email = str(row[4]).strip().lower() if len(row) > 4 else ""
    match = int(bool(domain(website) and email.endswith("@" + domain(website))))
    return (size, geography_priority(row), cae, -match)


def prospect_score(row):
    """Pontuação auxiliar (0-100); apenas lead_priority_key decide a ordem."""
    if not in_target_segment(row):
        return 0
    size_points = {0: 60, 1: 52, 2: 12, 3: 4}[size_priority(row)]
    zone_points = {0: 20, 1: 12, 2: 5}[geography_priority(row)]
    cae_points = {0: 15, 1: 10, 2: 3}[cae_priority(row)]
    website = str(row[3]) if len(row) > 3 else ""
    email = str(row[4]).strip().lower() if len(row) > 4 else ""
    contact_points = 5 if domain(website) and email.endswith("@" + domain(website)) else 0
    return min(100, size_points + zone_points + cae_points + contact_points)


def proposal_content(row, verified_hook=""):
    """Rascunho de abordagem sem atribuir problemas não comprovados ao destinatário."""
    name = str(row[0]).strip()[:75] if row else ""
    sector = norm(row[1]) if len(row) > 1 else ""
    if any(x in sector for x in ("contab", "accountant")):
        examples = "reconciliações, tratamento de documentos e mapas Excel"
    elif any(x in sector for x in ("imobili", "estate_agent")):
        examples = "organização de contactos, gestão de pedidos e relatórios"
    elif any(x in sector for x in ("distribu", "wholesale", "trade", "logistics")):
        examples = "tratamento de encomendas, atualização de inventário e relatórios"
    else:
        examples = "organização de documentos, atualização de Excel e relatórios"
    subject = "TimeSaver | Poupe tempo e reduza custos com automação"
    hook = re.sub(r"[\r\n\t]+", " ", str(verified_hook or "")).strip()[:160]
    particular = (
        f"Vimos na vossa informação pública a referência a {hook}. "
        "Gostaríamos de perceber se existem processos associados que faça sentido simplificar.\n\n"
        if hook else ""
    )
    body = (
        (f"Bom dia, equipa {name}," if name else "Bom dia,") + "\n\n"
        "Somos a TimeSaver e ajudamos pequenas empresas a reduzir tarefas "
        "administrativas repetitivas através de automatizações adaptadas "
        "às ferramentas que já utilizam.\n\n"
        + particular +
        "Alguns exemplos de processos que podemos ajudar a automatizar incluem "
        + examples + ". Não sabemos se estes processos representam uma necessidade "
        "na vossa empresa; gostaríamos precisamente de o perceber.\n\n"
        "Faria sentido uma breve conversa, sem compromisso?\n\n"
        "https://timesaverautomate.com\n\n"
        "Se não quiserem receber novos contactos comerciais da TimeSaver, "
        "basta responder «Não contactar» a esta mensagem.\n\n"
        "Cumprimentos,\nEquipa TimeSaver"
    )
    return subject, body


def draft_proposal(row):
    """Rascunho interno; nunca envia mensagens."""
    subject, body = proposal_content(row)
    return "RASCUNHO NÃO ENVIADO — Assunto: " + subject + "\n" + body



SEND_ELIGIBILITY_LABEL = "Elegível para envio"
VALID_LEGAL_BASES = {"Consentimento documentado", "Pessoa coletiva - fundamento validado"}


def recent_date(value, today, max_age_days):
    """Uma data humana escrita no CRM, validada sem aceitar futuro."""
    try:
        d = date.fromisoformat(str(value or "").strip())
    except ValueError:
        return False
    age = (today - d).days
    return 0 <= age <= max_age_days


def evaluate_send_eligibility(crm_row, review_row, suppressed_emails=(), today=None):
    """Fail closed: aprovação explícita, evidências recentes e sem oposição."""
    def value(row, index):
        return str(row[index]).strip() if len(row) > index else ""
    today = today or datetime.now(ZoneInfo("Europe/Lisbon")).date()
    email = value(crm_row, 4).lower()
    website = value(crm_row, 3)
    if norm(value(crm_row, 24)) != "nao":
        return False, "Bloqueio Não contactar no CRM"
    if value(review_row, 8) != "Verificado":
        return False, "Revisão não concluída"
    basis = value(review_row, 9)
    if basis not in VALID_LEGAL_BASES or value(crm_row, 23) != basis:
        return False, "Base legal não documentada de forma consistente"
    if not EMAIL_RE.fullmatch(email):
        return False, "Email inválido"
    local, email_domain = email.rsplit("@", 1)
    if email in {str(e).lower() for e in suppressed_emails}:
        return False, "Oposição ou supressão"
    if local not in GENERIC_LOCAL_PARTS or email_domain in FREE_EMAIL_DOMAINS:
        return False, "Contacto não é caixa empresarial genérica"
    if not domain(website) or domain(website) != email_domain:
        return False, "Domínio da empresa não confirmado"
    if value(crm_row, 20) not in ("", "0") or value(crm_row, 22):
        return False, "Contacto já abordado"
    if value(crm_row, 21):
        return False, "Estado Resend exige confirmação"
    if len(review_row) < len(REVIEW_HEADERS):
        return False, "Campos de aprovação em falta"
    if (value(review_row, 11) == "" or
        value(review_row, 0) != value(crm_row, 0) or
        value(review_row, 4).lower() != email or
        domain(value(review_row, 3)) != domain(website)):
        return False, "Revisão não corresponde à empresa/email"
    if value(review_row, 16) != "Aprovado":
        return False, "Aprovação de envio pendente"
    if not recent_date(value(review_row, 18), today, 30):
        return False, "Aprovação de envio desatualizada"
    if not recent_date(value(review_row, 14), today, 90):
        return False, "Confirmação de email desatualizada"
    if not value(review_row, 15):
        return False, "Fonte de validação em falta"
    if basis == "Pessoa coletiva - fundamento validado":
        if value(review_row, 12) != "Pessoa coletiva":
            return False, "Natureza jurídica não confirmada"
        if not recent_date(value(review_row, 13), today, 31):
            return False, "Consulta DGC não documentada ou desatualizada"
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
        "Por verificar", "", f"Dimensão: {'micro verificada' if size_priority(crm_row) == 0 else 'pequena verificada' if size_priority(crm_row) == 1 else 'por confirmar'}; Score comercial: {prospect_score(crm_row)}/100; " + draft_proposal(crm_row), str(line_number),
        "", "", "", "", "", "", "",
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
    for score, row in sorted(
        rows, key=lambda pair: (lead_priority_key(pair[1]), -pair[0])
    ):
        email = str(row[4]).strip().lower()
        if email in seen:
            continue
        seen.add(email)
        unique.append((score, row))
    return unique



def simulate_resend(credentials, crm_rows, limit=30):
    """Simulação integral de elegibilidade e payload Resend; sem chamadas à Resend."""
    response = requests.get(
        f"{API}/values/{quote(chr(39) + 'Revisão Comercial' + chr(39) + '!A1:S10000', safe='')}",
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
        if not review or norm(review[0]) != norm(crm_row[0]) or (len(review) > 4 and str(review[4]).strip().lower() != str(crm_row[4]).strip().lower()):
            reason = "Revisão ausente ou não corresponde ao CRM"
            allowed = False
        else:
            allowed, reason = evaluate_send_eligibility(crm_row, review, suppressed)
            if allowed and str(review[9]).strip() != "Consentimento documentado":
                allowed, reason = False, "Resend exige opt-in; cold outreach proibido"
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
        f"{API}/values/{quote(chr(39) + 'Revisão Comercial' + chr(39) + '!A:S', safe='')}:append",
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


def prioritized_candidates(groups, limit):
    """Escalões de dimensão, depois zona, e só depois CAE/setor.

    O preenchimento é progressivo: prioridade alta até à quota, alargando
    aos escalões inferiores quando o volume do escalão anterior é insuficiente.
    Diversifica cidades dentro do mesmo escalão de prioridade.
    """
    ranked = sorted({
        lead_priority_key(row)[:3]
        for group in groups for row in group if in_target_segment(row)
    })
    output = []
    for rank in ranked:
        tier_groups = [
            [row for row in group if lead_priority_key(row)[:3] == rank]
            for group in groups
        ]
        output.extend(balanced_candidates(tier_groups, limit - len(output)))
        if len(output) >= limit:
            break
    return output


def find_candidates(existing, limit, day=None):
    seen = existing_keys(existing)
    groups = []
    successful, failed = 0, 0
    plan = search_plan(day)
    print("Plano de pesquisa: " + "; ".join(
        f"{name} ({kind})" for name, _, _, _, kind in plan
    ), flush=True)
    for city, lat, lon, radius, kind in plan:
        # Filtrar apenas estabelecimentos com email já documentado no OSM.
        # Evita consumir o limite de resultados com POI sem contacto e mantém
        # a exclusão de caixas pessoais em candidate().
        # Bbox pequena usa índice espacial e evita operações radiais globais.
        # A zona continua aproximada, não é um município confirmado.
        lat_delta = radius / 111_320
        lon_delta = radius / (111_320 * max(0.2, math.cos(math.radians(lat))))
        bbox = f"{lat-lat_delta:.5f},{lon-lon_delta:.5f},{lat+lat_delta:.5f},{lon+lon_delta:.5f}"
        # Recolhe setores empresariais amplos e aplica depois os escalões
        # de prioridade. Assim, não desaparecem pequenas empresas de
        # setores secundários só porque não constam de uma regex restrita.
        query = (
            "[out:json][timeout:20];("
            f'nwr({bbox})["office"]["name"]["contact:email"];'
            f'nwr({bbox})["office"]["name"]["email"];'
            f'nwr({bbox})["shop"]["name"]["contact:email"];'
            f'nwr({bbox})["shop"]["name"]["email"];'
            f'nwr({bbox})["craft"]["name"]["contact:email"];'
            f'nwr({bbox})["craft"]["name"]["email"];'
            ");out tags 600;"
        )
        elements = None
        for endpoint in ENDPOINTS[:2]:
            try:
                response = requests.get(
                    endpoint, params={"data": query},
                    headers={"User-Agent": "TimeSaverAutomation/1.3 (business research; timesaverautomate.com)"},
                    timeout=(5, 12),
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
            if row is not None and in_target_segment(row) and not is_duplicate(row, seen):
                local.append(row)
        # A fonte não devolve os elementos por potencial comercial.
        local.sort(key=lead_priority_key)
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
    candidates = prioritized_candidates(groups, limit)
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
    for source in sorted(candidates, key=lead_priority_key):
        row = list(source)
        if not in_target_segment(row):
            continue
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
