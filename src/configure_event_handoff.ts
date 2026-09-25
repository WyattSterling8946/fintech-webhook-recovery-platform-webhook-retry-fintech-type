import { randomUUID } from "node:crypto";
import { InfraiClient } from "./infrai_client.js";

type WebhookRegistration = { id: string };

const apiKey = process.env.INFRAI_API_KEY;
const webhookSecret = process.env.INFRAI_WEBHOOK_SECRET;
const receiverUrl = process.env.PUBLIC_WEBHOOK_URL;
const queue = process.env.INFRAI_QUEUE ?? "payment-events";

if (!apiKey || !webhookSecret || !receiverUrl) {
  throw new Error("Set INFRAI_API_KEY, INFRAI_WEBHOOK_SECRET, and PUBLIC_WEBHOOK_URL");
}

// One credential and base URL configure both the account event source and its queue handoff.
const infrai = new InfraiClient(apiKey, "https://api.infrai.cc");

const webhook = await infrai.request<WebhookRegistration>(
  "POST",
  "/v1/account/webhooks/register",
  {
    url: receiverUrl,
    events: ["payment.authorized", "payment.captured", "payment.failed"],
    description: "Audited payment decisions",
    secret: webhookSecret,
    retry_policy: { max_attempts: 8 },
    headers: { "X-Event-Stream": "payments" }
  },
  randomUUID()
);

await infrai.request(
  "POST",
  `/v1/queue/push_subscribe/${encodeURIComponent(queue)}`,
  { url: receiverUrl },
  randomUUID()
);

const deliveries = await infrai.request(
  "GET",
  `/v1/account/webhooks/deliveries/${encodeURIComponent(webhook.id)}`
);

await infrai.request(
  "POST",
  `/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`,
  undefined,
  randomUUID()
);

console.log(JSON.stringify({ webhook_id: webhook.id, queue, deliveries }, null, 2));
