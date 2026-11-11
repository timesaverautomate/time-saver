"""Testes isolados: sem rede, sem escrita e sem emails."""
import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("prospect_crm", ROOT / "scripts" / "prospect_crm.py")
crm = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(crm)


def sample(name="Loja Alfa", email="geral@alfa.pt", osm_id=123):
    return {"type": "node", "id": osm_id, "tags": {
        "name": name, "contact:email": email, "website": "https://alfa.pt",
        "shop": "computer",
    }}


class ProspectCrmTests(unittest.TestCase):
    def test_candidate_is_blocked_from_contact(self):
        row = crm.candidate(sample(), "Porto")
        self.assertEqual(len(row), 26)
        self.assertEqual(row[24], "Sim")
        self.assertEqual(row[23], "Por avaliar")
        self.assertEqual(row[17:23], [""] * 6)
        self.assertEqual(row[25], "osm:node:123")

    def test_service_company_candidate_is_blocked(self):
        business = sample(name="Gabinete Exemplo", email="geral@exemplo.pt", osm_id=987)
        business["tags"].pop("shop")
        business["tags"]["office"] = "accountant"
        row = crm.candidate(business, "Porto")
        self.assertEqual(row[1], "accountant")
        self.assertEqual(row[24], "Sim")
        self.assertEqual(row[23], "Por avaliar")
        self.assertEqual(row[17:23], [""] * 6)

    def test_review_signals_never_authorize_contact(self):
        self.assertIn("coincide", crm.review_signals("geral@alfa.pt", "https://alfa.pt"))
        self.assertIn("diferente", crm.review_signals("geral@alfa.pt", "https://outra.pt"))
        self.assertIn("sem website", crm.review_signals("geral@alfa.pt", ""))
        row = crm.candidate(sample(), "Porto")
        self.assertIn("REVER:", row[16])
        self.assertEqual(row[24], "Sim")

    def test_review_row_is_never_preapproved(self):
        row = crm.review_row(crm.candidate(sample(), "Porto"), 25)
        self.assertEqual(len(row), 19)
        self.assertEqual(row[8], "Por verificar")
        self.assertEqual(row[9], "")
        self.assertIn("RASCUNHO NÃO ENVIADO", row[10])
        self.assertEqual(row[11], "25")

    def test_review_sync_preserves_existing_decisions(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        first = crm.candidate(sample(name="Já revista", email="geral@alfa.pt", osm_id=100), "Porto")
        second = crm.candidate(sample(name="Nova empresa", email="info@nova.pt", osm_id=101), "Braga")
        existing = crm.review_row(first, 2)
        existing[8] = "Verificado"
        existing[10] = "Decisão humana preservada"
        writes = []
        def fake_get(*args, **kwargs):
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"values": [crm.REVIEW_HEADERS, existing]})
        def fake_post(*args, **kwargs):
            writes.extend(kwargs["json"]["values"])
            return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"updates": {"updatedRows": 1}})
        with patch.object(crm.requests, "get", side_effect=fake_get), patch.object(crm.requests, "post", side_effect=fake_post):
            result = crm.sync_review(SimpleNamespace(token="fake"), [first, second])
        self.assertEqual(result, 1)
        self.assertEqual(writes[0][0], "Nova empresa")
        self.assertEqual(writes[0][8], "Por verificar")
        self.assertEqual(existing[8], "Verificado")
        self.assertEqual(existing[10], "Decisão humana preservada")

    def test_scoring_and_draft_never_authorize_send(self):
        row = crm.candidate(sample(), "Porto")
        row[1] = "accountant"
        row[8] = "Alta"
        row[7] = "Automatizar relatórios Excel"
        self.assertGreaterEqual(crm.prospect_score(row), 7)
        review = crm.review_row(row, 2)
        self.assertIn("RASCUNHO NÃO ENVIADO", review[10])
        self.assertEqual(review[8], "Por verificar")
        self.assertEqual(review[9], "")
        self.assertEqual(row[24], "Sim")
        without_email = list(row)
        without_email[4] = ""
        self.assertLess(crm.prospect_score(without_email), crm.prospect_score(row))

    def test_approved_commercial_email_is_not_sent(self):
        row = crm.candidate(sample(), "Porto")
        subject, body = crm.proposal_content(row)
        self.assertEqual(subject, "TimeSaver | Poupe tempo e reduza custos com automação")
        self.assertIn("organização de documentos", body)
        self.assertIn("atualização de Excel", body)
        self.assertIn("pequenas empresas", body)
        self.assertIn("breve conversa, sem compromisso", body)
        self.assertIn("Não contactar", body)
        self.assertIn("https://timesaverautomate.com", body)
        self.assertIn("RASCUNHO NÃO ENVIADO", crm.draft_proposal(row))
        self.assertEqual(row[24], "Sim")


    def test_resend_preview_is_only_data(self):
        row = crm.candidate(sample(), "Porto")
        row[1] = "accountant"
        preview = crm.build_resend_preview(row)
        self.assertEqual(preview["to"], "geral@alfa.pt")
        self.assertIn("Poupe tempo e reduza custos", preview["subject"])
        self.assertIn("reconciliações", preview["text"].casefold())
        self.assertEqual(preview["status"], "SIMULADO — NÃO ENVIADO")
        self.assertEqual(row[24], "Sim")

    def test_global_suppression_and_deduplication(self):
        blocked = crm.candidate(sample(), "Porto")
        allowed = list(blocked)
        allowed[24] = "Não"
        allowed[21] = ""
        self.assertIn("geral@alfa.pt", crm.suppression_index([blocked, allowed]))
        blocked[24] = "Não"
        blocked[21] = "Cancelou subscrição"
        self.assertIn("geral@alfa.pt", crm.suppression_index([blocked]))
        blocked[21] = ""
        self.assertEqual(crm.suppression_index([blocked]), set())
        unique = crm.unique_send_candidates([(2, blocked), (8, allowed)])
        self.assertEqual(len(unique), 1)
        self.assertEqual(unique[0][0], 8)

    def test_send_gate_fails_closed(self):
        row = crm.candidate(sample(), "Porto")
        review = crm.review_row(row, 2)
        allowed, reason = crm.evaluate_send_eligibility(row, review)
        self.assertFalse(allowed)
        self.assertIn("Não contactar", reason)
        row[24] = "Não"
        review[8] = "Verificado"
        review[9] = "Consentimento documentado"
        row[23] = "Consentimento documentado"
        review[14] = crm.today_lisbon()
        review[15] = "https://alfa.pt"
        review[16] = "Aprovado"
        review[18] = crm.today_lisbon()
        self.assertTrue(crm.evaluate_send_eligibility(row, review)[0])
        self.assertFalse(crm.evaluate_send_eligibility(row, review, {"geral@alfa.pt"})[0])
        review[9] = "Por avaliar"
        self.assertFalse(crm.evaluate_send_eligibility(row, review)[0])
        review[9] = "Consentimento documentado"
        row[20] = "1"
        self.assertFalse(crm.evaluate_send_eligibility(row, review)[0])

    def test_simulate_resend_reads_only_and_never_sends(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        row = crm.candidate(sample(), "Porto")
        review = crm.review_row(row, 2)
        review[8] = "Verificado"
        review[9] = "Consentimento documentado"
        fake = SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"values": [crm.REVIEW_HEADERS, review]},
        )
        with patch.object(crm.requests, "get", return_value=fake) as get, \
             patch.object(crm.requests, "post") as post:
            result = crm.simulate_resend(SimpleNamespace(token="fake"), [row])
        self.assertEqual(result["eligible"], 0)
        self.assertEqual(result["selected"], 0)
        self.assertEqual(get.call_count, 1)
        post.assert_not_called()

    def test_reject_personal_email(self):
        self.assertIsNone(crm.candidate(sample(email="joana@alfa.pt"), "Porto"))

    def test_reject_invalid_osm_id(self):
        self.assertIsNone(crm.candidate(sample(osm_id=0), "Porto"))

    def test_duplicate_email_name_domain_and_source(self):
        row = crm.candidate(sample(), "Porto")
        keys = crm.existing_keys([row])
        self.assertTrue(crm.is_duplicate(row, keys))
        same_email = crm.candidate(sample(name="Outro nome", osm_id=124), "Braga")
        self.assertTrue(crm.is_duplicate(same_email, keys))
        same_name_city = crm.candidate(sample(email="info@outra.pt", osm_id=125), "Porto")
        self.assertTrue(crm.is_duplicate(same_name_city, keys))

    def test_manual_write_guard(self):
        env = {
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_REPOSITORY_ID": "1452563434",
            "GITHUB_REPOSITORY": "timesaverautomate/time-saver",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_WORKFLOW_REF": (
                "timesaverautomate/time-saver/.github/workflows/prospect-crm.yml@refs/heads/main"
            ),
        }
        self.assertEqual(crm.validate_mode("teste_escrita_2", env), "teste_escrita_2")
        with self.assertRaises(RuntimeError):
            crm.validate_mode("teste_escrita_2", {**env, "GITHUB_EVENT_NAME": "schedule"})
        with self.assertRaises(RuntimeError):
            crm.validate_mode("teste_escrita_2", {**env, "GITHUB_REF": "refs/heads/other"})
        with self.assertRaises(RuntimeError):
            crm.validate_mode("escrever_30", env)
        with self.assertRaises(RuntimeError):
            crm.validate_mode("diario", env)
        daily = {**env, "GITHUB_EVENT_NAME": "schedule"}
        self.assertEqual(crm.validate_mode("diario", daily), "simular")
        daily["CRM_DAILY_WRITE_ENABLED"] = "true"
        self.assertEqual(crm.validate_mode("diario", daily), "diario")
        from unittest.mock import patch
        with patch.object(crm, "DAILY_WRITE_APPROVED_IN_CODE", True):
            self.assertEqual(crm.validate_mode("diario", daily), "diario")
        with self.assertRaises(RuntimeError):
            crm.validate_mode("diario", {**daily, "GITHUB_REPOSITORY_ID": "999"})


    def test_webmail_is_rejected(self):
        self.assertIsNone(crm.candidate(sample(email="geral@gmail.com"), "Porto"))

    def test_daily_quota_retries_and_reset(self):
        row = crm.candidate(sample(), "Porto")
        day = "2026-11-10"
        row[16] = "OSM público; " + crm.AUTO_MARKER + day
        self.assertEqual(crm.daily_remaining([row] * (crm.MAX_DAILY_WRITES - 1), day), 1)
        self.assertEqual(crm.daily_remaining([row] * crm.MAX_DAILY_WRITES, day), 0)
        self.assertEqual(crm.daily_remaining([row] * crm.MAX_DAILY_WRITES, "2026-11-11"), crm.MAX_DAILY_WRITES)

    def test_prepare_daily_limited_and_uncontactable(self):
        day = "2026-11-10"
        older = []
        for i in range(crm.MAX_DAILY_WRITES - 1):
            old = crm.candidate(sample(name=f"Antiga {i}", email=f"info@old{i}.pt", osm_id=i + 100), "Porto")
            old[3] = f"https://old{i}.pt"
            old[16] = "OSM público; " + crm.AUTO_MARKER + day
            older.append(old)
        news = [
            crm.candidate(sample(name="Nova Um", email="info@nova1.pt", osm_id=500), "Braga"),
            crm.candidate(sample(name="Nova Dois", email="info@nova2.pt", osm_id=501), "Braga"),
        ]
        news[0][3] = "https://nova1.pt"
        news[1][3] = "https://nova2.pt"
        fresh = crm.prepare_rows_for_write(older, news, 30, day)
        self.assertEqual(len(fresh), 1)
        self.assertEqual(fresh[0][24], "Sim")
        self.assertEqual(fresh[0][23], "Por avaliar")
        self.assertEqual(fresh[0][17:23], [""] * 6)
        self.assertIn(crm.AUTO_MARKER + day, fresh[0][16])
        self.assertEqual(crm.prepare_rows_for_write(older + fresh, news, 30, day), [])

    def test_refuses_disabled_contact_block(self):
        row = crm.candidate(sample(), "Porto")
        row[24] = "Não"
        with self.assertRaises(RuntimeError):
            crm.prepare_rows_for_write([], [row], 2)

    def test_mocked_sheet_write_and_verification(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        day = "2026-11-10"
        row = crm.candidate(sample(), "Porto")
        written = []
        def fake_post(*args, **kwargs):
            written.extend(kwargs["json"]["values"])
            return SimpleNamespace(
                raise_for_status=lambda: None,
                json=lambda: {"updates": {"updatedRows": 1}},
            )
        with patch.object(crm, "read_rows", side_effect=lambda _: [] if not written else list(written)), \
             patch.object(crm.requests, "post", side_effect=fake_post):
            n = crm.write_candidates(SimpleNamespace(token="fake"), [row], 30, "diario", day)
        self.assertEqual(n, 1)
        self.assertEqual(crm.count_imports_today(written, day), 1)
        self.assertEqual(written[0][24], "Sim")

    def test_read_header_contract(self):
        self.assertEqual(len(crm.HEADERS), 26)
        self.assertEqual(crm.HEADERS[24], "Não contactar")


    def test_geographic_plan_rotates_and_prioritizes_suburbs(self):
        today = crm.search_plan("2026-11-11")
        tomorrow = crm.search_plan("2026-11-12")
        self.assertEqual(len(today), 8)
        self.assertEqual([z[4] for z in today].count("suburbio"), 5)
        self.assertEqual([z[4] for z in today].count("regional"), 2)
        self.assertEqual([z[4] for z in today].count("centro"), 1)
        self.assertNotEqual([z[0] for z in today], [z[0] for z in tomorrow])
        self.assertEqual(today, crm.search_plan("2026-11-11"))
        self.assertTrue(all(1500 <= z[3] <= 3000 for z in today))

    def test_suburban_score_is_evidence_based_and_location_cautious(self):
        metro = crm.candidate(sample(osm_id=400), "Porto", "centro")
        suburb = crm.candidate(sample(osm_id=401), "Maia", "suburbio")
        self.assertEqual(suburb[2], "Área de Maia (aproximada)")
        self.assertIn("Município não confirmado", suburb[16])
        self.assertIn("TIPO_ZONA=suburbio", suburb[16])
        self.assertGreater(crm.prospect_score(suburb), crm.prospect_score(metro))
        self.assertNotIn("DIMENSAO_VERIFICADA", suburb[16])
        with_evidence = list(suburb)
        with_evidence[16] += "; DIMENSAO_VERIFICADA=9; FONTE_DIMENSAO=https://fonte-exemplo.pt/equipa"
        self.assertGreater(crm.prospect_score(with_evidence), crm.prospect_score(suburb))
        self.assertEqual(crm.size_priority(with_evidence), 0)
        branded = sample(osm_id=402)
        branded["tags"]["brand"] = "Franquia hipotética"
        chain = crm.candidate(branded, "Maia", "suburbio")
        self.assertLess(crm.prospect_score(chain), crm.prospect_score(suburb))
        exact = sample(osm_id=403)
        exact["tags"]["addr:city"] = "Valongo"
        self.assertEqual(crm.candidate(exact, "Maia", "suburbio")[2], "Valongo")

    def test_no_website_kept_for_manual_research_not_sending(self):
        business = sample(osm_id=600)
        business["tags"].pop("website")
        row = crm.candidate(business, "Espinho", "regional")
        self.assertIsNotNone(row)
        self.assertEqual(row[3], "")
        self.assertEqual(row[24], "Sim")
        self.assertIn("sem website", row[16])
        review = crm.review_row(row, 2)
        self.assertFalse(crm.evaluate_send_eligibility(row, review)[0])

    def test_balanced_selection_is_round_robin(self):
        self.assertEqual(crm.balanced_candidates(
            [["porto1", "porto2", "porto3"], ["lisboa1", "lisboa2"], ["regiao1"]], 5
        ), ["porto1", "lisboa1", "regiao1", "porto2", "lisboa2"])
        self.assertEqual(crm.balanced_candidates([], 15), [])

    def test_deduplication_across_search_areas(self):
        base = crm.candidate(sample(osm_id=700), "Porto", "centro")
        other = crm.candidate(sample(name="Empresa com nova denominação", osm_id=701),
                              "Maia", "suburbio")
        self.assertTrue(crm.is_duplicate(other, crm.existing_keys([base])))
        other[4] = "info@outraempresa.pt"
        other[3] = "https://outraempresa.pt"
        self.assertFalse(crm.is_duplicate(other, crm.existing_keys([base])))

    def test_daily_discovery_quota_is_cautious(self):
        self.assertEqual(crm.MAX_DAILY_WRITES, 15)
        self.assertEqual(crm.MAX_PER_ZONE, 5)


    def test_overpass_query_uses_indexed_bbox_and_email_filters(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        element = sample(name="Pequena Empresa Teste", email="geral@alfa.pt", osm_id=444)
        data = SimpleNamespace(status_code=200, json=lambda: {"elements": [element]})
        with patch.object(crm.requests, "get", return_value=data) as get, \
             patch.object(crm.time, "sleep", return_value=None):
            rows = crm.find_candidates([], 3, day="2026-11-11")
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(get.call_args_list), 8)
        first = get.call_args_list[0]
        self.assertEqual(first.args[0], crm.ENDPOINTS[0])
        query = first.kwargs["params"]["data"]
        self.assertIn('["contact:email"]', query)
        self.assertIn('["email"]', query)
        self.assertNotIn("around:", query)
        self.assertIn("nwr(", query)
        self.assertEqual(rows[0][24], "Sim")


    def test_size_is_first_even_when_sector_or_city_is_better(self):
        # Pequena empresa fora do setor prioritário ultrapassa setor prioritário
        # sem prova da dimensão. Centro urbano não supera subúrbio por si só.
        small = crm.candidate(sample(osm_id=810), "Lisboa", "centro")
        small[1] = "pet"
        small[16] += "; DIMENSAO_VERIFICADA=15; FONTE_DIMENSAO=https://fonte.pt/equipa"
        unknown = crm.candidate(sample(osm_id=811), "Maia", "suburbio")
        unknown[1] = "accountant"
        self.assertEqual(crm.size_priority(small), 1)
        self.assertEqual(crm.size_priority(unknown), 2)
        self.assertLess(crm.lead_priority_key(small), crm.lead_priority_key(unknown))
        self.assertEqual(crm.prioritized_candidates([[unknown], [small]], 2)[0], small)

    def test_micro_precedes_small_independent_of_sector(self):
        micro = crm.candidate(sample(osm_id=812), "Porto", "centro")
        micro[1] = "pet"
        micro[16] += "; DIMENSAO_VERIFICADA=4; FONTE_DIMENSAO=https://fonte.pt/relatorio"
        small = crm.candidate(sample(osm_id=813, email="geral@outra.pt"), "Maia", "suburbio")
        small[1] = "accountant"
        small[16] += "; DIMENSAO_VERIFICADA=22; FONTE_DIMENSAO=https://fonte.pt/relatorio"
        self.assertLess(crm.lead_priority_key(micro), crm.lead_priority_key(small))
        self.assertEqual(crm.prioritized_candidates([[small], [micro]], 2)[0], micro)

    def test_verified_large_is_excluded_but_unknown_not_assumed_large(self):
        large = crm.candidate(sample(osm_id=814), "Porto", "centro")
        large[16] += "; DIMENSAO_VERIFICADA=50; FONTE_DIMENSAO=https://fonte.pt/relatorio"
        self.assertIsNone(crm.size_priority(large))
        no_source = list(large)
        no_source[16] = no_source[16].split("FONTE_DIMENSAO")[0]
        self.assertEqual(crm.size_priority(no_source), 2)
        small = crm.candidate(sample(osm_id=815, email="geral@nova.pt"), "Porto", "centro")
        kept = crm.prepare_rows_for_write([], [large, small], 15)
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0][0], small[0])

    def test_fallback_sector_only_after_small_size_priority(self):
        # O setor secundário entra quando faltam candidatos nos setores principais,
        # sem inverter a ordem por dimensão.
        primary = crm.candidate(sample(osm_id=816), "Maia", "suburbio")
        primary[1] = "accountant"
        secondary = crm.candidate(sample(osm_id=817, email="geral@outra.pt"), "Porto", "centro")
        secondary[1] = "architect"
        unknown = crm.candidate(sample(osm_id=818, email="geral@mais.pt"), "Braga", "regional")
        unknown[1] = "unknown"
        self.assertEqual(crm.prioritized_candidates([[unknown], [secondary], [primary]], 1), [primary])
        self.assertEqual(crm.prioritized_candidates([[unknown], [secondary], [primary]], 2), [primary,secondary])
        self.assertEqual(crm.prioritized_candidates([[unknown], [secondary], [primary]], 3), [primary,secondary,unknown])

    def test_brand_is_lower_priority_not_proof_of_large_size(self):
        independent=crm.candidate(sample(osm_id=819), "Porto", "centro")
        branded_element=sample(osm_id=820,email="geral@marca.pt")
        branded_element["tags"]["brand"]="Exemplo"
        branded=crm.candidate(branded_element, "Maia", "suburbio")
        self.assertEqual(crm.size_priority(independent),2)
        self.assertEqual(crm.size_priority(branded),3)
        self.assertGreater(crm.lead_priority_key(branded),crm.lead_priority_key(independent))


if __name__ == "__main__":
    unittest.main()
