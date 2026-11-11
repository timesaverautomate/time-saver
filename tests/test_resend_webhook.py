"""Testes isolados da validação do endpoint, sem rede nem escrita."""
import importlib.util
import base64
import json
import pathlib
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("resend_webhook", ROOT / "resend_webhook.py")
webhook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(webhook)


class WebhookTests(unittest.TestCase):
    @staticmethod
    def signed(body):
        secret = "whsec_" + base64.b64encode(b"synthetic-test-key-only-32-bytes!").decode()
        timestamp = datetime.now(timezone.utc)
        message_id = "synthetic-message-id"
        signature = webhook.Webhook(secret).sign(message_id, timestamp, body)
        return secret, {
            "svix-id": message_id,
            "svix-timestamp": str(int(timestamp.timestamp())),
            "svix-signature": signature,
        }

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

    def test_actual_sdk_signature_returns_parsed_event_and_dry_run_never_writes(self):
        payload = {"type": "email.delivered", "data": {"email_id": "synthetic-only"}}
        body = json.dumps(payload)
        secret, headers = self.signed(body)
        self.assertEqual(webhook.verified_payload(body, headers, secret), payload)
        with patch.dict("os.environ", {"RESEND_WEBHOOK_SECRET": secret,
                                       "RESEND_WEBHOOK_WRITE_ENABLED": "false"}), \
             patch.object(webhook, "google_session") as session:
            response = webhook.app.test_client().post(
                "/webhooks/resend", data=body, headers=headers,
                content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["mode"], "dry_run")
        session.assert_not_called()

    def test_tampering_with_an_actually_signed_body_is_rejected_before_sheets(self):
        body = json.dumps({"type": "email.delivered", "data": {"email_id": "synthetic-only"}})
        secret, headers = self.signed(body)
        with patch.dict("os.environ", {"RESEND_WEBHOOK_SECRET": secret}), \
             patch.object(webhook, "google_session") as session:
            response = webhook.app.test_client().post(
                "/webhooks/resend", data=body + " ", headers=headers)
        self.assertEqual(response.status_code, 401)
        session.assert_not_called()

    def test_authenticated_non_object_or_malformed_json_is_rejected_without_writes(self):
        for body in ["[]", "null", "7", '"text"', "{broken",
                     json.dumps({"type": []}), json.dumps({"type": {}})]:
            with self.subTest(body=body):
                secret, headers = self.signed(body)
                with patch.dict("os.environ", {"RESEND_WEBHOOK_SECRET": secret}), \
                     patch.object(webhook, "google_session") as session:
                    response = webhook.app.test_client().post(
                        "/webhooks/resend", data=body, headers=headers)
                self.assertEqual(response.status_code, 400)
                session.assert_not_called()


if __name__ == "__main__":
    unittest.main()
