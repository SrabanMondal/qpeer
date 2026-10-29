import { sql } from "drizzle-orm";
import { AppError } from "../../lib/errors";
import { sha256Hex, verifyHmac } from "../../lib/hmac";
import { razorpayWebhookSecret } from "./razorpay";
import { confirmPayment, markFailed, markRefund, type PayCtx } from "./service";

/**
 * POST /v1/webhooks/razorpay (public, signature-checked; §10.2 step 4).
 *
 * 1. `X-Razorpay-Signature` = HMAC-SHA256(raw body, webhook secret), checked
 *    on the **raw** body before any parsing (bad/missing → 400).
 * 2. Dedupe by `X-Razorpay-Event-Id` (else the body's SHA-256) in
 *    `webhook_events`: an event already processed answers 200 at once; one
 *    that failed half-way is processed again on redelivery.
 * 3. `payment.captured` → `confirmPayment` (same idempotent path as the
 *    client verify); `payment.failed` → `failed`; `refund.processed` /
 *    `refund.failed` → the refund status. Other events are acknowledged.
 *
 * Never logs the body or the signature.
 */

interface WebhookEvent {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        amount?: number;
        error_code?: string | null;
      };
    };
    refund?: { entity?: { id?: string; payment_id?: string } };
  };
}

export async function handleRazorpayWebhook(
  ctx: PayCtx,
  rawBody: string,
  signature: string | undefined,
  eventIdHeader: string | undefined,
): Promise<{ ok: true; duplicate?: boolean }> {
  const { db, env, now } = ctx;
  let secret: string;
  try {
    secret = razorpayWebhookSecret(env);
  } catch (e) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        where: "payments.webhook",
        message: e instanceof Error ? e.message : "config",
      }),
    );
    throw new AppError(500, "internal");
  }
  if (!signature || !(await verifyHmac(secret, rawBody, signature))) {
    throw new AppError(400, "invalid_input", "Bad webhook signature");
  }
  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    throw new AppError(400, "invalid_input", "Body must be valid JSON");
  }
  const type = typeof event.event === "string" ? event.event : "unknown";
  const id = eventIdHeader?.trim() || `sha256:${await sha256Hex(rawBody)}`;

  await db.run(sql`INSERT INTO webhook_events (id, type, received_at, processed_at)
      VALUES (${id.slice(0, 128)}, ${type.slice(0, 64)}, ${now}, NULL)
      ON CONFLICT(id) DO NOTHING`);
  const seen = await db.get<{ processed_at: number | null }>(
    sql`SELECT processed_at FROM webhook_events WHERE id = ${id.slice(0, 128)}`,
  );
  if (seen?.processed_at) return { ok: true, duplicate: true };

  const payment = event.payload?.payment?.entity;
  switch (type) {
    case "payment.captured":
    case "order.paid":
      if (payment?.id && payment.order_id) {
        await confirmPayment(
          ctx,
          payment.order_id,
          payment.id,
          null,
          typeof payment.amount === "number" ? payment.amount : undefined,
        );
      }
      break;
    case "payment.failed":
      if (payment?.order_id) {
        await markFailed(db, payment.order_id, now, payment.error_code ?? null);
      }
      break;
    case "refund.processed":
    case "refund.failed": {
      const refund = event.payload?.refund?.entity;
      if (refund?.id) {
        await markRefund(
          db,
          refund.id,
          type === "refund.processed" ? "processed" : "failed",
          now,
        );
      }
      break;
    }
    default:
      break;
  }
  await db.run(sql`UPDATE webhook_events SET processed_at = ${now}
      WHERE id = ${id.slice(0, 128)}`);
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      where: "payments.webhook",
      type,
      eventId: id.slice(0, 64),
    }),
  );
  return { ok: true };
}
