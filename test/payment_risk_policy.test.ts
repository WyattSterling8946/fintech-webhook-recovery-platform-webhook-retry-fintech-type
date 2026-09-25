import assert from "node:assert/strict";
import test from "node:test";
import { decidePaymentAction, paymentEventSchema } from "../src/payment_risk_policy.js";

test("holds a high-risk authorization for review", () => {
  const event = paymentEventSchema.parse({
    id: "evt_ledger_42",
    type: "payment.authorized",
    created_at: "2026-09-19T08:15:00.000Z",
    data: {
      payment_id: "pay_42",
      account_id: "acct_7",
      amount_minor: 12500,
      currency: "USD",
      risk_score: 87
    }
  });

  assert.deepEqual(decidePaymentAction(event), {
    eventId: "evt_ledger_42",
    paymentId: "pay_42",
    action: "manual_review",
    auditNote: "payment.authorized at 2026-09-19T08:15:00.000Z; risk=87"
  });
});
