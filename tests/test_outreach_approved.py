"""Testes sem rede da passagem revisão -> envio -> CRM -> reconciliação."""
import importlib.util
import pathlib
import sys
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch, Mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import prospect_crm as crm
import outreach_approved as delivery


def company(osm_id=101, email="geral@exemplo.pt", site="https://exemplo.pt"):
    row = crm.candidate({"type":"node","id":osm_id,"tags":{
        "name":"Micro Empresa Teste","contact:email":email,
        "office":"accountant","website":site
    }}, "Maia", "suburbio")
    row[23] = "Pessoa coletiva - fundamento validado"
    row[24] = "Não"
    return row


def approved(row=None, line=2, day="2026-11-11"):
    row = row or company()
    review = crm.review_row(row, line)
    review[8] = "Verificado"
    review[9] = row[23]
    review[12] = "Pessoa coletiva"
    review[13] = day
    review[14] = day
    review[15] = "https://exemplo.pt/legal"
    review[16] = "Aprovado"
    review[17] = "processamento de documentos"
    review[18] = day
    return review


class SafeOutreachTests(unittest.TestCase):
    def test_approved_company_only(self):
        day = date(2026,11,11)
        row = company()
        review = approved(row)
        selected, reasons = delivery.select_approved([row],[review],today=day)
        self.assertEqual(len(selected),1)
        self.assertEqual(selected[0][0],2)
        self.assertTrue(crm.evaluate_send_eligibility(row,review,today=day)[0])
        review[16] = "Não aprovado"
        self.assertEqual(delivery.select_approved([row],[review],today=day)[0],[])
        self.assertEqual(delivery.select_approved([row],[review],today=day)[1]["Aprovação de envio pendente"],1)

    def test_dgc_and_proof_are_mandatory(self):
        day = date(2026,11,11)
        row = company()
        review = approved(row)
        for index, value in [(13,""),(13,"2026-09-01"),(14,""),(15,""),(18,"2026-09-01")]:
            x = list(review)
            x[index] = value
            self.assertFalse(crm.evaluate_send_eligibility(row,x,today=day)[0])
        review[12] = "Pessoa singular"
        self.assertFalse(crm.evaluate_send_eligibility(row,review,today=day)[0])
        review[12] = "Pessoa coletiva"
        row[23] = "Por avaliar"
        self.assertFalse(crm.evaluate_send_eligibility(row,review,today=day)[0])
        row[23] = "Pessoa coletiva - fundamento validado"
        row[24] = "Sim"
        self.assertFalse(crm.evaluate_send_eligibility(row,review,today=day)[0])

    def test_duplicate_domain_or_history(self):
        day=date(2026,11,11)
        first=company()
        second=company(102,email="info@exemplo.pt")
        selected,_=delivery.select_approved([first,second],
                            [approved(first,2), approved(second,3)],today=day)
        self.assertEqual(len(selected),1)
        first[20]="1"
        selected,_=delivery.select_approved([first,second],
                            [approved(first,2), approved(second,3)],today=day)
        self.assertEqual(selected,[])

    def test_review_must_match_line_name_and_email(self):
        row=company()
        review=approved(row)
        different=list(review)
        different[4]="geral@outra.pt"
        self.assertEqual(delivery.select_approved([row],[different],today=date(2026,11,11))[0],[])
        different=list(review)
        different[11]="3"
        self.assertEqual(delivery.select_approved([row],[different],today=date(2026,11,11))[0],[])
        self.assertEqual(delivery.index_reviews([review,review]),{})

    def test_idempotency_and_public_unsubscribe(self):
        row=company()
        r=approved(row)
        k=delivery.idempotency_for(row)
        self.assertEqual(k,delivery.idempotency_for(row))
        self.assertNotEqual(k,delivery.idempotency_for(company(104,email="info@exemplo.pt")))
        msg=delivery.resend_payload(row,r,"pedidos@timesaverautomate.com")
        self.assertEqual(msg["to"],["geral@exemplo.pt"])
        self.assertIn("Não contactar",msg["text"])
        self.assertIn("processamento de documentos",msg["text"])
        self.assertIn("timesaverautomate.com",msg["from"])

    def test_preview_does_not_send(self):
        self.assertEqual(delivery.safe_env("preview",{}),"preview")
        with self.assertRaises(RuntimeError):
            delivery.safe_env("send",{})
        allowed={
            "GITHUB_REPOSITORY_ID":"1452563434",
            "GITHUB_REPOSITORY":"timesaverautomate/time-saver",
            "GITHUB_REF":"refs/heads/main",
            "GITHUB_WORKFLOW_REF":"timesaverautomate/time-saver/.github/workflows/outreach-legal.yml@refs/heads/main",
            "GITHUB_EVENT_NAME":"workflow_dispatch",
        }
        with self.assertRaises(RuntimeError):
            delivery.safe_env("send",allowed)
        self.assertEqual(delivery.safe_env("send",{**allowed,"CRM_OUTREACH_CONFIRM":"ENVIAR"}),"send")

    def test_send_records_id_and_followup_but_never_resends(self):
        row=company()
        review=approved(row)
        rows=[list(row)]
        revisions=[list(review)]
        messages=[]
        writes=[]
        def write(_creds,updates,_http):
            writes.extend(updates)
            for update in updates:
                import re
                a=re.search(r"!([A-Z]+)(\d+)(?::([A-Z]+)\d+)?",update["range"])
                start=a.group(1)
                pos=0
                for ch in start: pos=pos*26+ord(ch)-64
                values=update["values"][0]
                for offset,value in enumerate(values):
                    rows[int(a.group(2))-2].extend([""]*max(0,pos-1+offset-len(rows[int(a.group(2))-2])+1))
                    rows[int(a.group(2))-2][pos-1+offset]=value
        fake=SimpleNamespace(post=lambda url,**kw: (messages.append((url,kw)) or
            SimpleNamespace(raise_for_status=lambda:None,json=lambda:{"id":"resend-12345678"})))
        with patch.object(delivery,"read_crm",side_effect=lambda *_: [list(x) for x in rows]), \
             patch.object(delivery,"read_review",side_effect=lambda *_: revisions), \
             patch.object(delivery,"batch_cells",side_effect=write):
            result=delivery.send_approved(SimpleNamespace(token="test"),
                "re_fake","pedidos@timesaverautomate.com",
                today="2026-11-11",http=fake)
            self.assertEqual(result["sent"],1)
            self.assertEqual(len(messages),1)
            self.assertEqual(rows[0][22],"resend-12345678")
            self.assertEqual(rows[0][20],1)
            self.assertEqual(rows[0][21],"Enviado")
            again=delivery.send_approved(SimpleNamespace(token="test"),
                "re_fake","pedidos@timesaverautomate.com",
                today="2026-11-11",http=fake)
            self.assertEqual(again["sent"],0)
            self.assertEqual(len(messages),1)

    def test_reservation_persists_after_ambiguous_failure(self):
        row=company()
        review=approved(row)
        rows=[list(row)]
        states=[]
        def write(_credentials,updates,_http):
            states.extend(updates)
            rows[0][21]=updates[0]["values"][0][0]
        class FailingHttp:
            def post(self,*args,**kwargs):
                raise TimeoutError("Indeterminate external response")
        fake=FailingHttp()
        with patch.object(delivery,"read_crm",side_effect=lambda *_:[list(x) for x in rows]), \
             patch.object(delivery,"read_review",return_value=[review]), \
             patch.object(delivery,"batch_cells",side_effect=write):
            with self.assertRaises(TimeoutError):
                delivery.send_approved(SimpleNamespace(token="test"),"re_fake",
                    "pedidos@timesaverautomate.com",today="2026-11-11",http=fake)
        self.assertTrue(rows[0][21].startswith("Reservado:"))
        self.assertTrue(states)

    def test_reconciliation_updates_delivery_and_suppression(self):
        self.assertEqual(delivery.delivery_status("delivered","Enviado"),"Entregue")
        self.assertIsNone(delivery.delivery_status("sent","Entregue"))
        self.assertEqual(delivery.delivery_status("suppressed","Enviado"),"Suprimido")
        self.assertIsNone(delivery.delivery_status("sent","Spam"))


if __name__=="__main__":
    unittest.main()
