import { sql } from "drizzle-orm";
import { AppError } from "../../lib/errors";
import { sha256Hex, verifyHmac } from "../../lib/hmac";
import { type RazorpayPayment, razorpayWebhookSecret } from "./razorpay";
import { confirmPayment, markFailed, markRefund, type PayCtx } from "./service";

/**
 * POST /v1/webhooks/razorpay (public, signature-checked; §10.2 step 4).
 *
 * 1. `X-Razorpay-Signature` = HMAC-SHA256(raw body, webhook secret), checked
 *    on the **raw** body before any parsing (bad/missing → 400).
 * 2. Dedupe by `X-Razorpay-Event-Id` (else the body's SHA-256) in
 *    `webhook_events`: an event already processed answers 200 at once; one
 *    that failed half-way is processed again on redelivery.
 * 3. `payment.captured` / `order.paid` / `payment.authorized` →
 *    `confirmPayment` (same idempotent path as the client verify; an
 *    authorized payment is captured there, G1); `payment.failed` → `failed`;
 *    `refund.processed` → done (a refund we did not make, e.g. from the
 *    Razorpay dashboard, is adopted if it covers what we owe);
 *    `refund.failed` → `refund_due` again for the cron. Other events are acknowledged. A provider error answers 502, so
 *    Razorpay delivers the event again.
 *
 * Never logs the body or the signature.
 */

interface PaymentEntity {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  created_at?: number;
  error_code?: string | null;
}

interface WebhookEvent {
  event?: string;
  payload?: {
    payment?: { entity?: PaymentEntity };
    refund?: { entity?: { id?: string; payment_id?: string } };
  };
}

/**
 * The signed event's payment entity as Razorpay's word on the payment, or
 * undefined (then `confirmPayment` fetches it) when the amount is missing.
 */
function reportedPayment(
  type: string,
  e: PaymentEntity,
  id: string,
  orderId: string,
): RazorpayPayment | undefined {
  if (typeof e.amount !== "number") return undefined;
  return {
    id,
    order_id: orderId,
    amount: e.amount,
    currency: typeof e.currency === "string" ? e.currency : "INR",
    status:
      typeof e.status === "string"
        ? e.status
        : type === "payment.authorized"
          ? "authorized"
          : "captured",
    created_at: e.created_at,
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
    case "payment.authorized":
    case "order.paid":
      // Unknown order: logged and acknowledged (no retry storm); the 15-min
      // recovery confirms it if the order shows up in D1 later.
      if (payment?.id && payment.order_id) {
        await confirmPayment(
          ctx,
          payment.order_id,
          payment.id,
          null,
          reportedPayment(type, payment, payment.id, payment.order_id),
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
          ctx,
          refund.id,
          type === "refund.processed" ? "processed" : "failed",
          refund.payment_id,
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
