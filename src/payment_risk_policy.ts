import { z } from "zod";

export const paymentEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["payment.authorized", "payment.captured", "payment.failed"]),
  created_at: z.string().datetime(),
  data: z.object({
    payment_id: z.string().min(1),
    account_id: z.string().min(1),
    amount_minor: z.number().int().positive(),
    currency: z.string().length(3),
    risk_score: z.number().min(0).max(100)
  })
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export type PaymentAction = {
  eventId: string;
  paymentId: string;
  action: "capture" | "manual_review" | "record_failure" | "record_capture";
  auditNote: string;
};

export function decidePaymentAction(event: PaymentEvent): PaymentAction {
  let action: PaymentAction["action"];
  if (event.type === "payment.failed") action = "record_failure";
  else if (event.type === "payment.captured") action = "record_capture";
  else action = event.data.risk_score >= 70 ? "manual_review" : "capture";

  return {
    eventId: event.id,
    paymentId: event.data.payment_id,
    action,
    auditNote: `${event.type} at ${event.created_at}; risk=${event.data.risk_score}`
  };
}
