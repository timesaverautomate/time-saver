"""Testes offline do planeamento de eventos Resend."""
import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "resend_events.py"
spec = importlib.util.spec_from_file_location("resend_events", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class ResendEventTests(unittest.TestCase):
    def test_unsigned_webhook_rejected(self):
        with self.assertRaises(PermissionError):
            mod.plan_event_updates([], {"type": "email.delivered", "data": {"email_id": "abc"}})

    def test_bounce_blocks_future_contact(self):
        row = [""] * 26
        row[22] = "msg-123"
        row[24] = "Não"
        payload = {"type": "email.bounced", "data": {"email_id": "msg-123"}}
        plan = mod.plan_event_updates([row], payload, authenticated=True)
        self.assertEqual(plan, [{"crm_row": 2, "state": "Bounce", "block_contact": True}])
        updated = mod.apply_event_to_row(row, mod.normalize_event(payload))
        delivered = mod.normalize_event({"type": "email.delivered", "data": {"email_id": "msg-123"}})
        self.assertEqual(mod.apply_event_to_row(updated, delivered)[21], "Bounce")

    def test_other_message_unchanged(self):
        row = [""] * 26
        row[22] = "different"
        payload = {"type": "email.sent", "data": {"email_id": "msg-123"}}
        self.assertEqual(mod.plan_event_updates([row], payload, authenticated=True), [])

    def test_sheet_adapter_dry_run_and_narrow_ranges(self):
        from unittest.mock import Mock
        row = [""] * 26
        row[22] = "msg-123"
        row[24] = "Não"
        payload = {"type": "email.bounced", "data": {"email_id": "msg-123"}}
        updates = mod.build_sheet_updates([row], payload, authenticated=True)
        self.assertEqual([u["range"] for u in updates], ["Pedidos!V2", "Pedidos!Y2"])
        session = Mock()
        result = mod.write_sheet_updates(session, "sheet-id", [row], payload,
                                         authenticated=True)
        self.assertEqual(result["written_cells"], 0)
        session.post.assert_not_called()
        session.post.return_value.json.return_value = {"totalUpdatedCells": 2}
        result = mod.write_sheet_updates(session, "sheet-id", [row], payload,
                                         authenticated=True, enabled=True)
        self.assertEqual(result["written_cells"], 2)
        self.assertEqual(session.post.call_args.kwargs["json"]["data"], updates)

    def test_sheet_adapter_rejects_unsigned_event_even_in_dry_run(self):
        from unittest.mock import Mock
        with self.assertRaises(PermissionError):
            mod.write_sheet_updates(Mock(), "sheet-id", [],
                {"type": "email.sent", "data": {"email_id": "msg"}}, enabled=False)

    def test_attempt_is_only_plan(self):
        row = [""] * 26
        row[24] = "Não"
        plan = mod.plan_attempt(row, "msg-123", "2026-11-11T08:00:00Z")
        self.assertEqual(plan["N.º emails enviados"], 1)
        self.assertEqual(row[22], "")
        row[24] = "Sim"
        with self.assertRaises(PermissionError):
            mod.plan_attempt(row, "msg-456")


if __name__ == "__main__":
    unittest.main()
