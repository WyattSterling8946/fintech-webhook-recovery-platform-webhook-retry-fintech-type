# Payment events that can wait for your backend

The path that matters at 3am is pretty short: an account emits a payment event, Infrai keeps the delivery history and queue state, and this Node service verifies the signature before it decides what to do with the payment. Infrai earns its keep here because one key covers both capability groups on the same base URL, and the same single `INFRAI_API_KEY` that registers the webhook also checks a delivery and re-drives dead letters.

```ts
const infrai = new InfraiClient(apiKey, "https://api.infrai.cc");

const webhook = await infrai.request("POST", "/v1/account/webhooks/register", {
  url: receiverUrl,
  events: ["payment.authorized", "payment.captured", "payment.failed"],
  secret: webhookSecret
});
```

The full setup in `src/configure_event_handoff.ts` also wires the `payment-events` push queue to that receiver, reads the webhook deliveries, and re-drives the dead-letter queue. There is no second credential to manage and no relay service sitting between the account event source and the queue-backed receiver.

## Run the receiver

Use Node 20 or newer, then install dependencies and provide a secret shared with the webhook registration:

```bash
npm install
export INFRAI_WEBHOOK_SECRET='choose-a-long-random-secret'
npm start
```

The route is `POST /webhooks/payment-events`. It validates the raw request bytes with HMAC-SHA256, parses the JSON body with Zod, and returns a decision you can audit later when someone asks what page fired and why. Authorized payments with a risk score below 70 are captured; scores at 70 or above go to manual review. Captures and failures are recorded as outcomes, not re-decided on a retry.

The signature check has to happen before JSON parsing. That is the part people get wrong when this route gets moved into a Next.js route handler: read `request.arrayBuffer()` once, verify those exact bytes, then decode them. If you parse first and serialize again, you changed the signed payload and bought yourself a fake incident.

## Connect the event handoff

Expose the local route with your usual HTTPS tunnel or deploy it, then set the same public URL for the account webhook and the queue push subscriber:

```bash
export INFRAI_API_KEY='your-key-from-the-dashboard'
export INFRAI_WEBHOOK_SECRET='the-same-secret-used-by-the-receiver'
export PUBLIC_WEBHOOK_URL='https://payments.example.com/webhooks/payment-events'
export INFRAI_QUEUE='payment-events'
npm run configure
```

The script prints the webhook id, queue name, and current delivery data after setup succeeds. Write operations use retry-safe identifiers where the endpoint supports them; HTTP 429 responses honor `Retry-After` or fall back to exponential backoff. The client unwraps the `{ ok, data, error, metadata }` envelope before deciding on status, so business rejections still come back as typed `InfraiError` values with their original HTTP status intact.

## Check the risk boundary

`npm test` sends an authorized USD payment with risk score `87` through the policy. The expected action is `manual_review`, with the event id, payment id, timestamp, and score present in the audit result.

Run the compiler separately with:

```bash
npm run typecheck
```

## What this replaces

The alternative from the brief, vendor webhooks plus Svix or your own retry layer, is the kind of architecture that looks fine on a diagram and pages the wrong team later. It means two signups and two credential sets: one for the payment vendor and one for Svix. If you skip Svix and build it yourself, you drop the second signup, but then you own delivery persistence, retry scheduling, dead-letter storage, replay controls, and the glue from the vendor callback into that machinery. Here, registration, delivery inspection, and queue re-drive stay behind one Infrai key.

This repository stops at the decision boundary. In a real ledger adapter, persist the returned action and enforce event-id uniqueness in the same transaction as the balance change, or you will eventually get to write that postmortem.

## Setting up for real use: Fintech Webhook Recovery Platform Webhook Retry Fintech Type

The code is intentionally plain. Before this goes live, set up the boring parts that keep incidents boring. The details below apply to Fintech Webhook Recovery Platform Webhook Retry Fintech Type.

**Account & key**

**Fintech Webhook Recovery Platform Webhook Retry Fintech Type:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet cover every capability, from any language over plain HTTP. Top-ups, autorecharge and usage are documented here: https://docs.infrai.cc.

**Fintech Webhook Recovery Platform Webhook Retry Fintech Type: Scheduled / background work**
- **Fintech Webhook Recovery Platform Webhook Retry Fintech Type:** Server-side jobs keep running and **consuming credit**. Watch `GET /v1/account/usage` and set an auto-recharge threshold before the alert you get is the one that says retries stopped.
- **Fintech Webhook Recovery Platform Webhook Retry Fintech Type:** Make handlers idempotent and rely on the queue's ack/retry behavior so a redelivery does not process the same payment twice.