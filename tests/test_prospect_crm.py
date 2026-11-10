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
            "GITHUB_REPOSITORY": "timesaverautomate/time-saver",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_WORKFLOW_REF": (
                "timesaverautomate/time-saver/.github/workflows/prospect-crm.yml@refs/heads/main"
            ),
        }
        crm.validate_mode("teste_escrita_2", env)
        with self.assertRaises(RuntimeError):
            crm.validate_mode("teste_escrita_2", {**env, "GITHUB_EVENT_NAME": "schedule"})
        with self.assertRaises(RuntimeError):
            crm.validate_mode("teste_escrita_2", {**env, "GITHUB_REF": "refs/heads/other"})
        with self.assertRaises(RuntimeError):
            crm.validate_mode("escrever_30", env)

    def test_read_header_contract(self):
        self.assertEqual(len(crm.HEADERS), 26)
        self.assertEqual(crm.HEADERS[24], "Não contactar")


if __name__ == "__main__":
    unittest.main()
