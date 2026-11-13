"""Sem rede: só emails comprovados entram em 'Pedidos chat'."""
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))

import sync_chat_sent as sync
import prospect_crm as crm
import outreach_approved as outreach


def sample(company="Microempresa Exemplo", email="geral@exemplo.pt", sent="gmail:18c8ac01fddb092a",
           state="Enviado Gmail", when="2026-11-13T16:20:00+00:00", count="1"):
    row=[""]*26
    row[0]=company
    row[1]="accountant"
    row[2]="Maia"
    row[3]="https://exemplo.pt"
    row[4]=email
    row[18]=when
    row[20]=count
    row[21]=state
    row[22]=sent
    return row


class ChatSentTests(unittest.TestCase):
    def test_valid_gmail_and_resend_mirror_rows_are_distinct(self):
        gmail=sync.chat_row(sample())
        resend=sync.chat_row(sample(sent="d55d8e24-416a-4fbd-9ea4-207f19a542c3",state="Entregue"))
        self.assertEqual(len(gmail),15)
        self.assertEqual(len(resend),15)
        self.assertEqual(gmail[3],"geral@exemplo.pt")
        self.assertEqual(gmail[4],"Microempresa Exemplo")
        self.assertNotEqual(gmail[0],resend[0])
        self.assertIn("Gmail",gmail[14])
        self.assertIn("Resend",resend[14])
        self.assertIn("não comprova entrega",gmail[13])

    def test_no_drafts_reservations_pre_cutoff_or_fake(self):
        self.assertIsNone(sync.chat_row(sample(sent="",state="",count="0")))
        self.assertIsNone(sync.chat_row(sample(sent="gmail:18c8ac01fddb092a",state="Reservado: xyz")))
        self.assertIsNone(sync.chat_row(sample(when="2026-11-12T18:20:00+00:00")))
        self.assertIsNone(sync.chat_row(sample(sent="gmail:INVALID")))
        self.assertIsNone(sync.chat_row(sample(count="0")))
        self.assertIsNone(sync.chat_row(sample(email="nao-email")))

    def test_dedup_reference_across_repeated_scans(self):
        row=sample()
        ref=sync.chat_row(row)[0]
        result=sync.new_records([row,row],[[ref]])
        self.assertEqual(result,[])
        result=sync.new_records([row,row],[])
        self.assertEqual(len(result),1)
        self.assertEqual(result[0][0],ref)

    def test_read_headers_fails_closed(self):
        response=SimpleNamespace(raise_for_status=lambda:None,json=lambda:{"values":[["Wrong"]]})
        with self.assertRaises(RuntimeError):
            sync.read_chat(SimpleNamespace(token="fake"),SimpleNamespace(get=lambda *_a,**_kw:response))

    def test_preview_reads_only_and_never_appends(self):
        original=sample()
        with patch.object(outreach,"read_crm",return_value=[original]), \
             patch.object(sync,"read_chat",return_value=[]), \
             patch.object(sync,"append_chat") as append:
            result=sync.sync(SimpleNamespace(token="dummy"),dry_run=True)
        self.assertEqual(result,{"found":1,"appended":0})
        append.assert_not_called()

    def test_sync_appends_once_and_verifies(self):
        original=sample()
        rows=[]
        def read(_creds,_http):
            return list(rows)
        def append(_creds,new,_http):
            rows.extend(new)
            return len(new)
        with patch.object(outreach,"read_crm",return_value=[original]), \
             patch.object(sync,"read_chat",side_effect=read), \
             patch.object(sync,"append_chat",side_effect=append):
            first=sync.sync(SimpleNamespace(token="dummy"),dry_run=False)
            second=sync.sync(SimpleNamespace(token="dummy"),dry_run=False)
        self.assertEqual(first,{"found":1,"appended":1})
        self.assertEqual(second,{"found":0,"appended":0})
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0][4],"Microempresa Exemplo")

    def test_append_rejects_unexpected_payload(self):
        with self.assertRaises(ValueError):
            sync.append_chat(SimpleNamespace(token="dummy"),[["wrong"]])

    def test_append_uses_sheet_and_raw_values(self):
        row=sync.chat_row(sample())
        calls=[]
        response=SimpleNamespace(raise_for_status=lambda:None,json=lambda:{"updates":{"updatedRows":1}})
        def post(url,**kwargs):
            calls.append((url,kwargs))
            return response
        written=sync.append_chat(SimpleNamespace(token="dummy"),[row],SimpleNamespace(post=post))
        self.assertEqual(written,1)
        self.assertIn("Pedidos%20chat",calls[0][0])
        self.assertEqual(calls[0][1]["params"]["valueInputOption"],"RAW")
        self.assertEqual(calls[0][1]["json"]["values"],[row])


if __name__=="__main__":
    unittest.main()
