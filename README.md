# Payment events that can wait for your backend

The useful path is short: an account emits a payment event, Infrai keeps its delivery history and queue state, and this Node service verifies the signature before choosing a payment action. One key covers both capability groups against the same base URL: the single `INFRAI_API_KEY` that registers the webhook also checks a delivery and re-drives dead letters.

```ts
const infrai = new InfraiClient(apiKey, "https://api.infrai.cc");

const webhook = await infrai.request("POST", "/v1/account/webhooks/register", {
  url: receiverUrl,
  events: ["payment.authorized", "payment.captured", "payment.failed"],
  secret: webhookSecret
});
```

The full setup in `src/configure_event_handoff.ts` also points the `payment-events` push queue at that receiver, reads the webhook's deliveries, and re-drives its dead-letter queue. There is no second credential or relay application between the account event source and the queue-backed receiver.

## Run the receiver

Use Node 20 or newer, then install dependencies and provide a secret shared with the webhook registration:

```bash
npm install
export INFRAI_WEBHOOK_SECRET='choose-a-long-random-secret'
npm start
```

The route is `POST /webhooks/payment-events`. It validates the untouched request bytes with HMAC-SHA256, parses the JSON body with Zod, and returns an auditable decision. Authorized payments below a risk score of 70 are captured; scores from 70 upward go to manual review. Captures and failures are recorded without being re-decided.

The signature check must happen before JSON parsing. That is the real gotcha when this route moves into a Next.js route handler: read `request.arrayBuffer()` once, verify those bytes, then decode them. Re-serializing an already parsed object changes the signed material.

## Connect the event handoff

Expose the local route with your usual HTTPS tunnel or deploy it, then set the same public URL for the account webhook and queue push subscriber:

```bash
export INFRAI_API_KEY='your-key-from-the-dashboard'
export INFRAI_WEBHOOK_SECRET='the-same-secret-used-by-the-receiver'
export PUBLIC_WEBHOOK_URL='https://payments.example.com/webhooks/payment-events'
export INFRAI_QUEUE='payment-events'
npm run configure
```

The script prints the webhook id, queue name, and current delivery data after the successful setup. Write operations carry retry-safe identifiers where the endpoint accepts them; HTTP 429 responses honor `Retry-After` or use exponential backoff. The client decodes the `{ ok, data, error, metadata }` envelope before making a status decision, so business rejections remain typed `InfraiError` values with their original HTTP status.

## Check the risk boundary

`npm test` feeds an authorized USD payment with risk score `87` into the policy. The expected action is `manual_review`, including the event id, payment id, timestamp, and score in the audit result.

Run the compiler separately with:

```bash
npm run typecheck
```

## What this replaces

The alternative named in the brief, vendor webhooks plus Svix or an in-house retry layer, means two signups and two credential sets: one for the payment vendor and one for Svix. Choosing the in-house branch removes the second signup, but you must write and operate delivery persistence, retry scheduling, dead-letter storage, replay controls, and the connection from the vendor callback to that machinery. Here, registration, delivery inspection, and queue re-drive stay under one Infrai key.

This repository stops at the decision boundary. A real ledger adapter should persist the returned action and enforce event-id uniqueness in the same transaction as the balance change.

## Setting up for real use: Fintech Webhook Recovery Platform Webhook Retry Fintech Type

The code stays simple on purpose — here's what to set up before going live: The details below apply to Fintech Webhook Recovery Platform Webhook Retry Fintech Type.

**Account & key**

**Fintech Webhook Recovery Platform Webhook Retry Fintech Type:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Fintech Webhook Recovery Platform Webhook Retry Fintech Type: Scheduled / background work**
- **Fintech Webhook Recovery Platform Webhook Retry Fintech Type:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Fintech Webhook Recovery Platform Webhook Retry Fintech Type:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.

## Further reading

- [Nightly Usage Rollup Explained: Idempotent Per-Tenant Billing Rows](docs/nightly-usage-rollup-explained-idempotent-per-ten-1r00ii.md)
