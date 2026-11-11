"""Testes isolados da validação do endpoint, sem rede nem escrita."""
import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("resend_webhook", ROOT / "resend_webhook.py")
webhook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(webhook)


class WebhookTests(unittest.TestCase):
    def test_rejects_missing_signature(self):
        with self.assertRaises(PermissionError):
            webhook.verified_payload("{}", {}, "whsec_test")

    def test_rejects_unconfigured_secret(self):
        with self.assertRaises(RuntimeError):
            webhook.verified_payload("{}", {}, "")

    def test_dry_run_requires_valid_signature(self):
        client = webhook.app.test_client()
        with patch.dict("os.environ", {"RESEND_WEBHOOK_SECRET": "whsec_test"}):
            response = client.post("/webhooks/resend", data="{}",
                                   content_type="application/json")
        self.assertEqual(response.status_code, 401)

    def test_verified_dry_run_never_calls_sheets(self):
        client = webhook.app.test_client()
        with patch.object(webhook, "verified_payload", return_value={
            "type": "email.bounced", "data": {"email_id": "test"}}), \
             patch.object(webhook, "google_session") as session, \
             patch.dict("os.environ", {"RESEND_WEBHOOK_WRITE_ENABLED": "false"}):
            response = client.post("/webhooks/resend", data="{}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["mode"], "dry_run")
        session.assert_not_called()


if __name__ == "__main__":
    unittest.main()
