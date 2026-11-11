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

if __name__ == "__main__":
    unittest.main()
