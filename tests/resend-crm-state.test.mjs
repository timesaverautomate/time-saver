import test from "node:test";
import assert from "node:assert/strict";
import { planCrmEvent } from "../workers/resend-webhook.js";

const emailId = "test-email-123";
function rows(status, blocked = "") {
  const header = Array(26).fill("");
  header[22] = "ID mensagem Resend";
  const row = Array(26).fill("");
  row[21] = status;
  row[22] = emailId;
  row[24] = blocked;
  return [header, row];
}
function event(type) { return { type, data: { email_id: emailId } }; }

test("delivered updates only the matching email status", () => {
  assert.deepEqual(planCrmEvent(rows("Enviado"), event("email.delivered")).updates,
    [{ range: "'Pedidos'!V2", values: [["Entregue"]] }]);
});
test("replayed delivered event is idempotent", () => {
  assert.equal(planCrmEvent(rows("Entregue"), event("email.delivered")).planned_cells, 0);
});
test("late sent, delayed and failed events cannot overwrite delivered", () => {
  for (const type of ["email.sent", "email.delivery_delayed", "email.failed"])
    assert.equal(planCrmEvent(rows("Entregue"), event(type)).planned_cells, 0);
});
test("bounce marks status and do-not-contact", () => {
  assert.deepEqual(planCrmEvent(rows("Enviado"), event("email.bounced")).updates, [
    { range: "'Pedidos'!V2", values: [["Bounce"]] },
    { range: "'Pedidos'!Y2", values: [["Sim"]] },
  ]);
});
test("spam complaint marks status and do-not-contact", () => {
  assert.deepEqual(planCrmEvent(rows("Entregue"), event("email.complained")).updates, [
    { range: "'Pedidos'!V2", values: [["Spam"]] },
    { range: "'Pedidos'!Y2", values: [["Sim"]] },
  ]);
});
test("terminal states are not overwritten by later events", () => {
  for (const current of ["Bounce", "Spam", "Cancelou subscrição"])
    for (const type of ["email.sent", "email.delivered", "email.bounced", "email.complained", "email.failed"])
      assert.equal(planCrmEvent(rows(current, "Sim"), event(type)).planned_cells, 0);
});
test("unmatched IDs do not write", () => {
  assert.equal(planCrmEvent(rows("Enviado"), {type:"email.delivered",data:{email_id:"other"}}).planned_cells, 0);
});
test("duplicate CRM message IDs fail closed", () => {
  const data = rows("Enviado");
  data.push([...data[1]]);
  assert.throws(() => planCrmEvent(data, event("email.delivered")), /duplicate_message_id/);
});
