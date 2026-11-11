#!/usr/bin/env python3
"""Teste de fonte OSM e geografia: sem Google, Resend ou efeitos externos de escrita."""
import prospect_crm as crm

if __name__ == "__main__":
    plan = crm.search_plan(crm.today_lisbon())
    assert len(plan) == 8
    assert sum(kind != "centro" for *_, kind in plan) == 7
    leads = crm.find_candidates([], 8, day=crm.today_lisbon())
    print("SMOKE OSM: pesquisa real terminada; candidatos únicos:", len(leads))
    print("Sem gravações no Google Sheets e sem emails.")
