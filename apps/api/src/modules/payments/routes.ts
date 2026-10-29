import {
  type ConfirmPaymentResponse,
  CreateOrderBody,
  PaymentsQuery,
  UpgradeBody,
  VerifyPaymentBody,
} from "@qpeer/shared";
import { type Context, Hono } from "hono";
import { db } from "../../db/client";
import type { AppEnv } from "../../env";
import { AppError } from "../../lib/errors";
import { verifyHmac } from "../../lib/hmac";
import { parseBody, parseQuery } from "../../lib/validate";
import {
  currentUser,
  membership,
  requireBusinessRole,
  requireRegistered,
} from "../../middleware/guards";
import { razorpayKeySecret } from "./razorpay";
import * as service from "./service";
import { handleRazorpayWebhook } from "./webhook";

const ctx = (c: Context<AppEnv>): service.PayCtx => ({
  db: db(c.env.DB),
  env: c.env,
  now: c.get("clock").now(),
});

/**
 * Payment routes (Step 4, architecture doc §10, §20). All need a registered
 * (non-anonymous) account; the webhook is public and mounted before auth.
 */
export const paymentRoutes = new Hono<AppEnv>()
  // PAY-01 / PRI-02: Razorpay order for a reservation or a Priority Pass.
  .post("/queues/:id/orders", requireRegistered(), async (c) => {
    const body = await parseBody(c, CreateOrderBody);
    const order = await service.createOrder(
      ctx(c),
      currentUser(c),
      c.req.param("id"),
      body,
    );
    return c.json(order, 201);
  })
  // PRI-05: "Skip ahead" order for the caller's WAITING ticket.
  .post("/tokens/:id/upgrade", requireRegistered(), async (c) => {
    const body = await parseBody(c, UpgradeBody);
    const order = await service.createUpgradeOrder(
      ctx(c),
      currentUser(c),
      c.req.param("id"),
      body,
    );
    return c.json(order, 201);
  })
  // PAY-03: Checkout's success callback, verified with the key secret, then
  // checked with Razorpay (captured, or captured now if only authorized).
  .post("/payments/verify", requireRegistered(), async (c) => {
    const body = await parseBody(c, VerifyPaymentBody);
    const user = currentUser(c);
    const pc = ctx(c);
    let secret: string;
    try {
      secret = razorpayKeySecret(c.env);
    } catch {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          where: "payments.verify",
          message: "payments not configured: RAZORPAY_KEY_SECRET missing",
        }),
      );
      throw new AppError(500, "internal");
    }
    const valid = await verifyHmac(
      secret,
      `${body.orderId}|${body.paymentId}`,
      body.signature,
    );
    if (!valid) {
      throw new AppError(
        400,
        "invalid_input",
        "Payment signature is not valid",
      );
    }
    const owned = await service.paymentOwnedBy(pc.db, body.orderId, user.id);
    if (!owned) throw new AppError(404, "not_found", "Not found");
    const r = await service.confirmPayment(
      pc,
      body.orderId,
      body.paymentId,
      user,
    );
    if (!r) throw new AppError(404, "not_found", "Not found");
    // G1: the signature alone is not money; Razorpay did not capture it.
    if (r.notCaptured) {
      throw new AppError(
        409,
        "invalid_state",
        "The payment did not complete, so no ticket was made",
        { paymentStatus: r.notCaptured },
      );
    }
    const names = await service.paymentNames(pc.db, r.payment.queueId);
    return c.json({
      payment: service.paymentView(r.payment, names),
      token: r.token,
      failure: r.failure,
    } satisfies ConfirmPaymentResponse);
  })
  // PAY-11: the caller's payment history.
  .get("/me/payments", requireRegistered(), async (c) => {
    const q = parseQuery(c, PaymentsQuery);
    return c.json(await service.myPayments(db(c.env.DB), currentUser(c).id, q));
  })
  // Business payment history with the net split (owner).
  .get(
    "/businesses/:id/payments",
    requireRegistered(),
    requireBusinessRole("owner", "business"),
    async (c) => {
      const q = parseQuery(c, PaymentsQuery);
      return c.json(
        await service.businessPayments(
          db(c.env.DB),
          membership(c).businessId,
          q,
        ),
      );
    },
  );

/** Public: Razorpay webhook (signature on the raw body, §10.2 step 4). */
export const webhookRoutes = new Hono<AppEnv>().post(
  "/webhooks/razorpay",
  async (c) => {
    const raw = await c.req.text();
    const r = await handleRazorpayWebhook(
      ctx(c),
      raw,
      c.req.header("x-razorpay-signature"),
      c.req.header("x-razorpay-event-id"),
    );
    return c.json(r);
  },
);
