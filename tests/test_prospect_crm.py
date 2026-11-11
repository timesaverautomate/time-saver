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
        self.assertEqual(len(row), 12)
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

    def test_sector_proposals_are_distinct_and_not_sent(self):
        accounting = crm.candidate(sample(), "Porto")
        accounting[1] = "accountant"
        retail = list(accounting)
        retail[1] = "computer"
        a_subject, a_body = crm.proposal_content(accounting)
        r_subject, r_body = crm.proposal_content(retail)
        self.assertNotEqual(a_subject, r_subject)
        self.assertIn("reconciliações", a_body)
        self.assertIn("stock", r_body)
        self.assertIn("Não sabemos", a_body)
        self.assertIn("RASCUNHO NÃO ENVIADO", crm.draft_proposal(accounting))
        self.assertEqual(accounting[24], "Sim")

    def test_resend_preview_is_only_data(self):
        row = crm.candidate(sample(), "Porto")
        row[1] = "accountant"
        preview = crm.build_resend_preview(row)
        self.assertEqual(preview["to"], "geral@alfa.pt")
        self.assertIn("contabilidade", preview["subject"])
        self.assertIn("reconciliações", preview["text"])
        self.assertEqual(preview["status"], "SIMULADO — NÃO ENVIADO")
        self.assertEqual(row[24], "Sim")

    def test_send_gate_fails_closed(self):
        row = crm.candidate(sample(), "Porto")
        review = crm.review_row(row, 2)
        allowed, reason = crm.evaluate_send_eligibility(row, review)
        self.assertFalse(allowed)
        self.assertIn("Não contactar", reason)
        row[24] = "Não"
        review[8] = "Verificado"
        review[9] = "Consentimento documentado"
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
        self.assertEqual(crm.daily_remaining([row] * 29, day), 1)
        self.assertEqual(crm.daily_remaining([row] * 30, day), 0)
        self.assertEqual(crm.daily_remaining([row] * 30, "2026-11-11"), 30)

    def test_prepare_daily_limited_and_uncontactable(self):
        day = "2026-11-10"
        older = []
        for i in range(29):
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


if __name__ == "__main__":
    unittest.main()
