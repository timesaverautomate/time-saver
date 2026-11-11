import unittest
from scripts.prospect_delivery_link import plan_email_id_update

class TestDeliveryLink(unittest.TestCase):
    def setUp(self):
        self.rows = [[""] * 26 for _ in range(3)]
        self.rows[1][4] = "geral@empresa.pt"
        self.rows[2][4] = "outro@empresa.pt"
        self.id = "01a1cac4-3b11-72cf-b6bc-32fc6bd7283b"

    def test_plan(self):
        self.assertEqual(plan_email_id_update(self.rows, 2, "GERAL@empresa.pt", self.id),
                         {"range": "'Pedidos'!W2", "values": [[self.id]]})

    def test_blocked(self):
        self.rows[1][24] = "Sim"
        with self.assertRaises(ValueError):
            plan_email_id_update(self.rows, 2, "geral@empresa.pt", self.id)

    def test_wrong_recipient(self):
        with self.assertRaises(ValueError):
            plan_email_id_update(self.rows, 2, "outro@empresa.pt", self.id)

    def test_existing_id(self):
        self.rows[1][22] = self.id
        self.assertIsNone(plan_email_id_update(self.rows, 2, "geral@empresa.pt", self.id))
        with self.assertRaises(ValueError):
            plan_email_id_update(self.rows, 2, "geral@empresa.pt", "different-id")

    def test_duplicate_id(self):
        self.rows[2][22] = self.id
        with self.assertRaises(ValueError):
            plan_email_id_update(self.rows, 2, "geral@empresa.pt", self.id)


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload
    def raise_for_status(self):
        pass
    def json(self):
        return self.payload

class FakeSession:
    def __init__(self, rows):
        self.rows = rows
        self.writes = []
    def get(self, url, **kwargs):
        return FakeResponse({"values": self.rows})
    def put(self, url, **kwargs):
        self.writes.append((url, kwargs))
        return FakeResponse({"updatedCells": 1})

class TestSaveResendId(unittest.TestCase):
    def test_write_exactly_w(self):
        from scripts.prospect_delivery_link import save_resend_id
        rows = [[""] * 26 for _ in range(2)]
        rows[0][22] = "ID mensagem Resend"
        rows[0][24] = "Não contactar"
        rows[1][4] = "geral@empresa.pt"
        fake = FakeSession(rows)
        credential = type("Credentials", (), {"token": "test-token"})()
        result = save_resend_id(credential, 2, "geral@empresa.pt",
                                "01a1cac4-3b11-72cf-b6bc-32fc6bd7283b", fake)
        self.assertTrue(result)
        self.assertEqual(len(fake.writes), 1)
        self.assertIn("W2", fake.writes[0][0])
        self.assertEqual(fake.writes[0][1]["params"]["valueInputOption"], "RAW")

    def test_blocked_does_not_write(self):
        from scripts.prospect_delivery_link import save_resend_id
        rows = [[""] * 26 for _ in range(2)]
        rows[0][22] = "ID mensagem Resend"
        rows[0][24] = "Não contactar"
        rows[1][4] = "geral@empresa.pt"
        rows[1][24] = "Sim"
        fake = FakeSession(rows)
        credential = type("Credentials", (), {"token": "test-token"})()
        with self.assertRaises(ValueError):
            save_resend_id(credential, 2, "geral@empresa.pt",
                           "01a1cac4-3b11-72cf-b6bc-32fc6bd7283b", fake)
        self.assertEqual(fake.writes, [])

if __name__ == "__main__":
    unittest.main()
