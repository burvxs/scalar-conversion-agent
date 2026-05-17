import express from "express";
import { createHmac } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadClient } from "./lib/load-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = resolve(__dirname, "../sessions");
const SESSION_FILE = resolve(SESSIONS_DIR, "current-abandoned.json");

const instance = await loadClient();
const WEBHOOK_SECRET = instance.api_keys.shopify_client_secret;

const app = express();

app.use(express.raw({ type: "application/json" }));

function validateHmac(rawBody: Buffer, signature: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn("[webhook] No client secret — skipping HMAC validation");
    return true;
  }
  const digest = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("base64");
  return digest === signature;
}

app.post("/webhooks/checkout", async (req, res) => {
  const signature = req.headers["x-shopify-hmac-sha256"] as string ?? "";
  const rawBody = req.body as Buffer;

  if (!validateHmac(rawBody, signature)) {
    console.error("[webhook] Invalid HMAC — rejected");
    res.status(401).send("Unauthorized");
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    res.status(400).send("Bad Request");
    return;
  }

  const lineItems = (payload.line_items as Array<Record<string, unknown>> | undefined) ?? [];
  const customer = (payload.customer as Record<string, unknown> | undefined) ?? {};

  const session = {
    checkout_token: payload.token ?? payload.id,
    received_at: new Date().toISOString(),
    current_cart: {
      line_items: lineItems.map((item) => ({
        title: item.title,
        quantity: item.quantity,
        price: item.price,
        variant_id: item.variant_id,
      })),
      total_price: payload.total_price,
      currency: payload.currency,
      abandoned_checkout_url: payload.abandoned_checkout_url,
    },
    customer_profile: {
      first_name: customer.first_name ?? payload.email,
      last_name: customer.last_name,
      email: customer.email ?? payload.email,
    },
  };

  await mkdir(SESSIONS_DIR, { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(session, null, 2), "utf-8");

  const email = session.customer_profile.email ?? "unknown";
  const itemCount = lineItems.length;
  console.log(`[webhook] Abandoned checkout saved — ${email} | ${itemCount} item(s) | £${payload.total_price}`);

  res.status(200).send("OK");
});

const PORT = process.env.WEBHOOK_PORT ?? 3000;
const server = app.listen(PORT, () => {
  console.log(`Webhook server listening on :${PORT} — POST /webhooks/checkout`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
