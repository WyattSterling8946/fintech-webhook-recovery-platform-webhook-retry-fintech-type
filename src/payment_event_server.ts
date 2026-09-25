import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { decidePaymentAction, paymentEventSchema } from "./payment_risk_policy.js";

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function hasValidSignature(body: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const supplied = signature.replace(/^sha256=/, "");
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(supplied, "hex");
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/webhooks/payment-events") {
    send(response, 404, { accepted: false });
    return;
  }

  const secret = process.env.INFRAI_WEBHOOK_SECRET;
  if (!secret) {
    send(response, 503, { accepted: false, reason: "receiver_not_configured" });
    return;
  }

  const body = await readBody(request);
  const signature = request.headers["x-infrai-signature"];
  if (typeof signature !== "string" || !hasValidSignature(body, signature, secret)) {
    send(response, 401, { accepted: false, reason: "invalid_signature" });
    return;
  }

  try {
    const event = paymentEventSchema.parse(JSON.parse(body.toString("utf8")));
    const decision = decidePaymentAction(event);
    console.log(JSON.stringify({ audit: decision }));
    send(response, 202, { accepted: true, decision });
  } catch (error) {
    const reason = error instanceof ZodError ? error.flatten() : "invalid_json";
    send(response, 400, { accepted: false, reason });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Payment event receiver listening on :${port}`));
