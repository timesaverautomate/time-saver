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
