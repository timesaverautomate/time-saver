"""Testes Gmail TimeSaver sem rede, credenciais, emails ou escrita real."""
import base64
import pathlib
import re
import sys
import unittest
from datetime import date
from email.parser import BytesParser
from email import policy
from types import SimpleNamespace
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import prospect_crm as crm
import outreach_approved as outreach
import gmail_outreach as gmail


def lead(osm_id=1001, email="geral@exemplo.pt"):
    row = crm.candidate({"type": "node", "id": osm_id, "tags": {
        "name": "Empresa autorizada", "contact:email": email,
        "office": "accountant", "website": "https://" + email.split("@")[1]
    }}, "Maia", "suburbio")
    row[23] = "Consentimento documentado"
    row[24] = "Não"
    return row


def review_for(row, line=2, proof=True):
    review = crm.review_row(row, line)
    review[8] = "Verificado"
    review[9] = "Consentimento documentado"
    review[12] = "Pessoa coletiva"
    review[14] = "2026-11-13"
    review[15] = "https://exemplo.pt/contactos"
    review[16] = "Aprovado"
    review[18] = "2026-11-13"
    review[10] = ("Autorização real confirmada; OPTIN_PROVA=https://arquivo.pt/consentimento; "
                  "OPTIN_DATA=2026-11-12") if proof else "Aprovado sem prova"
    return review


class GmailOutreachTests(unittest.TestCase):
    def test_ramp_weekly_and_weekdays(self):
        expected = [
            ("2026-11-13", 0), ("2026-11-16", 5), ("2026-11-20", 5),
            ("2026-11-23", 10), ("2026-11-30", 15),
            ("2026-12-07", 20), ("2026-12-14", 30),
            ("2026-12-19", 0), ("2027-01-04", 30),
        ]
        for day, cap in expected:
            with self.subTest(day=day):
                self.assertEqual(gmail.ramp_cap(day), cap)

    def test_fail_closed_on_proof_and_optin(self):
        r = lead()
        review = review_for(r, proof=False)
        selected, audit = gmail.approved_candidates([r], [review], "2026-11-16", 5)
        self.assertEqual(selected, [])
        self.assertEqual(audit["missing_documentary_proof"], 1)
        review = review_for(r)
        self.assertTrue(gmail.optin_evidence(review, date(2026,11,16)))
        selected, _ = gmail.approved_candidates([r], [review], "2026-11-16", 5)
        self.assertEqual(len(selected), 1)
        review[10] = "OPTIN_PROVA=https://arquivo.pt/registo; OPTIN_DATA=2024-01-01"
        self.assertFalse(gmail.optin_evidence(review, date(2026,11,16)))
        review[10] = "OPTIN_PROVA=https://arquivo.pt/registo; OPTIN_DATA=2026-12-01"
        self.assertFalse(gmail.optin_evidence(review, date(2026,11,16)))
        review[10] = "OPTIN_PROVA=http://arquivo.pt/registo; OPTIN_DATA=2026-11-12"
        self.assertFalse(gmail.optin_evidence(review, date(2026,11,16)))
        review = review_for(r)
        review[9] = "Pessoa coletiva - fundamento validado"
        self.assertFalse(gmail.optin_evidence(review, date(2026,11,16)))

    def test_no_contact_with_block_or_previous_history(self):
        row, review = lead(), review_for(lead())
        row[24] = "Sim"
        self.assertEqual(gmail.approved_candidates([row], [review], "2026-11-16", 5)[0], [])
        row[24] = "Não"
        row[20] = "1"
        self.assertEqual(gmail.approved_candidates([row], [review], "2026-11-16", 5)[0], [])

    def test_cap_counts_resend_and_gmail_in_same_day(self):
        first, second = lead(), lead(1002,email="info@outra.pt")
        first[18] = "2026-11-16T09:00:00"
        first[20] = "1"
        second[18] = "2026-11-16T09:10:00"
        second[20] = "1"
        remaining = gmail.approved_candidates([first,second], [], "2026-11-16", 5)[1]
        self.assertEqual(remaining["remaining_today"], 3)

    def test_safe_mode_github_protections(self):
        self.assertEqual(gmail.safe_mode("preview", {}), "preview")
        with self.assertRaises(RuntimeError):
            gmail.safe_mode("send", {})
        env = {
            "GITHUB_REPOSITORY_ID": "1452563434",
            "GITHUB_REPOSITORY": "timesaverautomate/time-saver",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_WORKFLOW_REF": "timesaverautomate/time-saver/.github/workflows/gmail-outreach.yml@refs/heads/main",
            "GMAIL_SEND_ENABLED": "true",
            "GITHUB_EVENT_NAME": "schedule",
        }
        self.assertEqual(gmail.safe_mode("send", env), "send")
        with self.assertRaises(RuntimeError):
            gmail.safe_mode("send", {**env, "GMAIL_SEND_ENABLED": "false"})
        with self.assertRaises(RuntimeError):
            gmail.safe_mode("send", {**env, "GITHUB_EVENT_NAME": "workflow_dispatch"})
        self.assertEqual(gmail.safe_mode("send", {**env, "GITHUB_EVENT_NAME":"workflow_dispatch",
                                                "GMAIL_SEND_CONFIRM":"ENVIAR"}), "send")

    def test_oauth_missing_or_different_account(self):
        with self.assertRaises(RuntimeError):
            gmail.oauth_access_token({})
        bad = SimpleNamespace(raise_for_status=lambda:None,
            json=lambda:{"email":"outra@gmail.com", "email_verified":True})
        with self.assertRaises(RuntimeError):
            gmail.check_sender_identity("a"*40, http=SimpleNamespace(get=lambda *a, **kw:bad))
        good = SimpleNamespace(raise_for_status=lambda:None,
            json=lambda:{"email":"timesaverautomate@gmail.com", "email_verified":True})
        self.assertEqual(gmail.check_sender_identity("a"*40, http=SimpleNamespace(get=lambda *a, **kw:good)),
                         gmail.GMAIL_SENDER)

    def test_mime_email_from_expected_sender_and_optout(self):
        r = lead()
        raw = base64.urlsafe_b64decode(gmail.email_raw(r, review_for(r))+"===")
        parsed = BytesParser(policy=policy.default).parsebytes(raw)
        self.assertEqual(parsed["From"].addresses[0].addr_spec, "timesaverautomate@gmail.com")
        self.assertEqual(parsed["To"].addresses[0].addr_spec, "geral@exemplo.pt")
        self.assertIn("Não contactar", parsed.get_content())

    def test_zero_eligible_sends_nothing_and_no_oauth(self):
        r = lead()
        with patch.object(outreach, "read_crm", return_value=[r]), \
             patch.object(outreach, "read_review", return_value=[review_for(r,proof=False)]), \
             patch.object(gmail, "oauth_access_token") as oauth:
            result = gmail.send_once(SimpleNamespace(token="x"),{}, day="2026-11-16")
        oauth.assert_not_called()
        self.assertEqual(result["sent"],0)
        self.assertEqual(result["cap"],5)

    def test_real_send_simulated_and_not_repeated(self):
        original=lead()
        review=review_for(original)
        rows=[list(original)]
        revisions=[review]
        sends=[]
        writes=[]
        def mutate(_credentials,updates,_http):
            writes.extend(updates)
            for update in updates:
                found = re.search(r"!([A-Z]+)(\d+)(?::([A-Z]+)\d+)?",update["range"])
                col=0
                for ch in found.group(1):col=col*26+ord(ch)-64
                target=rows[int(found.group(2))-2]
                for i,value in enumerate(update["values"][0]):
                    target[col-1+i] = value
        class Transport:
            def post(self,url,**kwargs):
                if url!=gmail.SEND_URL:
                    raise AssertionError("Apenas chamada Gmail permitida no teste")
                sends.append(kwargs)
                return SimpleNamespace(raise_for_status=lambda:None,
                    json=lambda:{"id":"18c8ac01fddb092a"})
        http=Transport()
        with patch.object(outreach, "read_crm",side_effect=lambda *_: [list(x) for x in rows]), \
             patch.object(outreach, "read_review",return_value=revisions), \
             patch.object(outreach, "batch_cells",side_effect=mutate), \
             patch.object(gmail, "oauth_access_token",return_value="a"*40), \
             patch.object(gmail, "check_sender_identity",return_value=gmail.GMAIL_SENDER):
            out=gmail.send_once(SimpleNamespace(token="x"),{}, day="2026-11-16",http=http)
            self.assertEqual(out["sent"],1)
            self.assertEqual(len(sends),1)
            self.assertEqual(rows[0][22], "gmail:18c8ac01fddb092a")
            self.assertEqual(rows[0][21], "Enviado Gmail")
            self.assertEqual(rows[0][20],1)
            again=gmail.send_once(SimpleNamespace(token="x"),{}, day="2026-11-16",http=http)
            self.assertEqual(again["sent"],0)
            self.assertEqual(len(sends),1)
        self.assertTrue(writes)

    def test_timeout_does_not_release_reservation_or_retry(self):
        original = lead()
        rows=[list(original)]
        calls=[]
        def write(_credentials,updates,_http):
            calls.append(updates)
            if updates[0]["range"]=="'Pedidos'!V2":
                rows[0][21]=updates[0]["values"][0][0]
        class TimeoutTransport:
            def post(self,*_args,**_kwargs):
                raise TimeoutError("Unknown whether Google accepted")
        with patch.object(outreach, "read_crm",side_effect=lambda *_: [list(x) for x in rows]), \
             patch.object(outreach, "read_review",return_value=[review_for(original)]), \
             patch.object(outreach, "batch_cells",side_effect=write), \
             patch.object(gmail, "oauth_access_token",return_value="a"*40), \
             patch.object(gmail, "check_sender_identity",return_value=gmail.GMAIL_SENDER):
            with self.assertRaises(TimeoutError):
                gmail.send_once(SimpleNamespace(token="x"),{}, day="2026-11-16",http=TimeoutTransport())
        self.assertTrue(rows[0][21].startswith("Reservado:"))
        self.assertEqual(len(calls),1)


if __name__ == "__main__":
    unittest.main()
