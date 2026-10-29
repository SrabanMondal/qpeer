import {
  type BusinessPaymentView,
  type CreateOrderBody,
  DEMO_BUSINESS_SHARE_PCT,
  type ErrorCode,
  isActiveState,
  istDayStart,
  MIN_ORDER_PAISE,
  ORDER_TTL_MS,
  type OrderResponse,
  type PaymentKind,
  type PaymentView,
  type QueueSettings,
  refundSplit,
  splitPaise,
  type TokenView,
  type UpgradeBody,
} from "@qpeer/shared";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  businesses,
  type Payment,
  payments,
  queues,
  tokens,
  type User,
} from "../../db/schema";
import type { Bindings } from "../../env";
import { BudgetSpent, type CallBudget } from "../../lib/call-budget";
import { AppError, notFound } from "../../lib/errors";
import { newId } from "../../lib/ids";
import { type TicketEnv, withTicket } from "../../lib/ticket-sign";
import { toMs } from "../../lib/time";
import type { DoResult, PaidOutcome } from "../../queue/queue-do";
import {
  type AlertPush,
  pushTransport,
  sendAlert,
} from "../notifications/expo-push";
import { queueStub, unwrap } from "../queue/do-client";
import {
  PaymentsConfigError,
  type RazorpayEnv,
  RazorpayError,
  type RazorpayPayment,
  type RazorpayRefund,
  razorpayKeyId,
  razorpayTransport,
  withBudget,
} from "./razorpay";

/**
 * Payments (Step 4, architecture doc §10; HLD §6.3). Rules:
 * - Amounts come from the queue settings, never from the app.
 * - `confirmPayment` (client verify, webhook, reconciliation) is idempotent
 *   and the only place that makes paid tickets.
 * - The ledger is append-only; each entry has a deterministic id, so a
 *   retry can never write it twice.
 * - Status transitions are guarded in SQL (`WHERE status = …`).
 * - Money counts as received only when Razorpay reports the payment
 *   `captured` (an `authorized` one is captured first); a client signature
 *   alone never makes a ticket.
 * - One order has one paying Razorpay payment. Any other captured payment on
 *   it (a retry that also went through) or one of the wrong amount is a
 *   stray: recorded as its own row and refunded in full.
 */

export type PayEnv = Pick<Bindings, "QUEUE" | "DB"> &
  RazorpayEnv &
  TicketEnv & { ENVIRONMENT?: string; EXPO_ACCESS_TOKEN?: string };

export interface PayCtx {
  db: Db;
  env: PayEnv;
  now: number;
  /**
   * Outbound call budget of a scheduled run (§14), shared by its jobs: every
   * Razorpay call and the `refund_issued` push count. Unset for HTTP requests.
   */
  budget?: CallBudget;
}

/** The Razorpay transport for this context, counted against its budget. */
function rzp(ctx: Pick<PayCtx, "env" | "budget">) {
  return withBudget(razorpayTransport(ctx.env), ctx.budget);
}

type DoFailure = { code: ErrorCode; message: string };

// ---------- helpers ----------

function logPayment(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, string | number | boolean | null>,
): void {
  // Ids, amounts and codes only: never secrets, signatures or bodies.
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    where: "payments",
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else console.log(line);
}

/** Wraps provider and config failures in the API's error shape (§7). */
async function provider<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    // Not a provider failure: the scheduled run stops here (§14).
    if (e instanceof BudgetSpent) throw e;
    if (e instanceof PaymentsConfigError) {
      logPayment("error", "config", { message: e.message });
      throw new AppError(500, "internal");
    }
    logPayment("error", "provider", {
      what,
      status: e instanceof RazorpayError ? e.status : null,
      code: e instanceof RazorpayError ? e.code : null,
    });
    throw new AppError(
      502,
      "payment_provider_error",
      "The payment provider did not answer; try again",
    );
  }
}

async function paymentByOrder(db: Db, orderId: string) {
  return db
    .select()
    .from(payments)
    .where(eq(payments.razorpayOrderId, orderId))
    .get();
}

async function paymentById(db: Db, id: string) {
  return db.select().from(payments).where(eq(payments.id, id)).get();
}

/** Reasons of a stray row (see the schema): money that bought nothing. */
type StrayReason = "duplicate_payment" | "amount_mismatch";

/** Our row id for a stray Razorpay payment (deterministic: a retry finds it). */
export const strayId = (razorpayPaymentId: string) =>
  `stray_${razorpayPaymentId}`;

const notStray = sql`(${payments.reason} IS NULL OR ${payments.reason} NOT IN ('duplicate_payment', 'amount_mismatch'))`;

/** Razorpay statuses that mean the customer's money is taken or held. */
const PAID_AT_RAZORPAY = new Set(["captured", "authorized"]);

/** Paid attempts first by time, so the earliest becomes the order's payment. */
function paidAttempts(list: RazorpayPayment[]): RazorpayPayment[] {
  return list
    .filter((rp) => PAID_AT_RAZORPAY.has(rp.status))
    .sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
}

function providerFields(e: unknown) {
  return {
    status: e instanceof RazorpayError ? e.status : null,
    code: e instanceof RazorpayError ? e.code : null,
    config: e instanceof PaymentsConfigError,
  };
}

async function namesFor(db: Db, queueId: string) {
  const r = await db
    .select({
      queueName: queues.name,
      businessName: businesses.name,
      businessId: businesses.id,
      queueStatus: queues.status,
      businessStatus: businesses.status,
      settingsJson: queues.settingsJson,
    })
    .from(queues)
    .innerJoin(businesses, eq(businesses.id, queues.businessId))
    .where(eq(queues.id, queueId))
    .get();
  return r ?? null;
}

export function paymentView(
  p: Payment,
  names: { queueName: string; businessName: string },
): PaymentView {
  return {
    id: p.id,
    kind: p.kind,
    status: p.status,
    amountPaise: p.amountPaise,
    refundPaise: p.refundPaise,
    refundStatus: p.refundStatus,
    queueId: p.queueId,
    queueName: names.queueName,
    businessId: p.businessId,
    businessName: names.businessName,
    tokenId: p.tokenId,
    createdAt: toMs(p.createdAt),
    updatedAt: toMs(p.updatedAt),
  };
}

// ---------- orders (PAY-01, PRI-02, PRI-05) ----------

/**
 * PRI-11: 1 pass (or upgrade) per account and per phone per queue per IST
 * day. An unpaid order of the same user and kind (and token) is returned
 * again instead of a second one; the user's other unpaid orders don't count
 * (if paid later, an impossible one is refunded in full).
 */
async function passLimit(
  db: Db,
  q: {
    queueId: string;
    userId: string;
    deviceHash: string;
    kind: "priority" | "upgrade";
    tokenId: string | null;
  },
  now: number,
): Promise<Payment | null> {
  const rows = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.queueId, q.queueId),
        inArray(payments.kind, ["priority", "upgrade"]),
        sql`${payments.createdAt} >= ${istDayStart(now)}`,
        sql`${payments.status} NOT IN ('failed', 'expired')`,
        notStray,
        or(
          eq(payments.userId, q.userId),
          eq(payments.deviceHash, q.deviceHash),
        ),
      ),
    )
    .all();
  let reuse: Payment | null = null;
  for (const p of rows) {
    const unpaid = p.status === "created" && toMs(p.expiresAt) > now;
    if (p.userId === q.userId && unpaid) {
      if (p.kind === q.kind && p.tokenId === q.tokenId) reuse = p;
      continue;
    }
    if (p.userId !== q.userId && !unpaid && p.status === "created") continue;
    throw new AppError(
      409,
      "pass_limit",
      "Only one Priority Pass per person and phone per queue per day",
    );
  }
  return reuse;
}

async function reusableOrder(
  db: Db,
  userId: string,
  queueId: string,
  kind: PaymentKind,
  now: number,
): Promise<Payment | null> {
  return (
    (await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.userId, userId),
          eq(payments.queueId, queueId),
          eq(payments.kind, kind),
          eq(payments.status, "created"),
          sql`${payments.expiresAt} > ${now}`,
        ),
      )
      .get()) ?? null
  );
}

function orderResponse(
  p: Payment,
  keyId: string,
  names: { queueName: string; businessName: string },
  settings: QueueSettings,
): OrderResponse {
  const pass = p.kind !== "reservation";
  return {
    paymentId: p.id,
    kind: p.kind,
    orderId: p.razorpayOrderId,
    keyId,
    amountPaise: p.amountPaise,
    currency: "INR",
    queueId: p.queueId,
    tokenId: p.kind === "upgrade" ? p.tokenId : null,
    businessName: names.businessName,
    queueName: names.queueName,
    expiresAt: toMs(p.expiresAt),
    rules: {
      cancelWindowMin: pass ? null : settings.cancelWindowMin,
      cancelRefundPct:
        p.kind === "priority" ? settings.priorityCancelRefundPct : null,
      validityMin: p.kind === "priority" ? settings.priorityValidityMin : null,
      graceMinutes: settings.graceMinutes,
      lateWindowMin: settings.lateWindowMin,
    },
  };
}

/** Creates the Razorpay order and our `created` payment row. */
async function newOrder(
  { db, env, now, budget }: PayCtx,
  p: {
    userId: string;
    queueId: string;
    businessId: string;
    kind: PaymentKind;
    amountPaise: number;
    deviceHash: string | null;
    tokenId: string | null;
  },
): Promise<Payment> {
  if (p.amountPaise < MIN_ORDER_PAISE) {
    throw new AppError(
      409,
      "invalid_state",
      "This fee is too small to pay online",
    );
  }
  const id = newId();
  const transport = await provider("transport", async () =>
    rzp({ env, budget }),
  );
  const order = await provider("create_order", () =>
    transport.createOrder({
      amount: p.amountPaise,
      currency: "INR",
      receipt: id,
      notes: { paymentId: id, queueId: p.queueId, kind: p.kind },
    }),
  );
  const at = new Date(now);
  await db.insert(payments).values({
    id,
    userId: p.userId,
    queueId: p.queueId,
    businessId: p.businessId,
    tokenId: p.tokenId,
    kind: p.kind,
    amountPaise: p.amountPaise,
    businessSharePct: DEMO_BUSINESS_SHARE_PCT,
    deviceHash: p.deviceHash,
    razorpayOrderId: order.id,
    razorpayPaymentId: null,
    status: "created",
    refundId: null,
    refundPaise: null,
    refundStatus: null,
    reason: null,
    expiresAt: new Date(now + ORDER_TTL_MS),
    createdAt: at,
    updatedAt: at,
  });
  logPayment("info", "order_created", {
    paymentId: id,
    kind: p.kind,
    amountPaise: p.amountPaise,
    queueId: p.queueId,
  });
  const row = await paymentById(db, id);
  if (!row) throw new Error("payment row missing");
  return row;
}

/** 409 `already_in_queue` (with its `tokenId`) when the payment's ticket is active. */
async function throwIfTicketActive(ctx: PayCtx, p: Payment): Promise<void> {
  if (p.status !== "allocated" || !p.tokenId) return;
  const r = await queueStub(ctx.env, p.queueId).getToken(p.tokenId);
  if (r.ok && isActiveState(r.value.token.state)) {
    throw new AppError(
      409,
      "already_in_queue",
      "You already paid for this. Open your ticket.",
      { tokenId: p.tokenId, paymentId: p.id },
    );
  }
}

/**
 * G5: never a second Checkout for something already paid. The user's
 * `captured` payments here whose ticket is not made yet are confirmed now; a
 * paid upgrade of this ticket counts too. If one of them holds an active
 * ticket → 409 `already_in_queue` with its `tokenId` (the app opens it).
 * Any other active ticket of the user here (an allocated reservation, a free
 * one, a pass) is refused by the DO's `checkPurchase` right after: one active
 * ticket per person per queue (INC-065).
 */
async function openTicketInstead(
  ctx: PayCtx,
  user: User,
  q: { queueId: string; kind: PaymentKind; tokenId?: string },
): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.userId, user.id),
        eq(payments.queueId, q.queueId),
        eq(payments.kind, q.kind),
        q.kind === "upgrade"
          ? and(
              eq(payments.tokenId, q.tokenId ?? ""),
              inArray(payments.status, ["captured", "allocated"]),
            )
          : eq(payments.status, "captured"),
      ),
    )
    .limit(5)
    .all();
  for (const row of rows) {
    let p = row;
    if (p.status === "captured" && p.razorpayPaymentId) {
      const r = await confirmPayment(
        ctx,
        p.razorpayOrderId,
        p.razorpayPaymentId,
        user,
      );
      p = r?.payment ?? p;
    }
    await throwIfTicketActive(ctx, p);
  }
}

/**
 * G5: an unpaid order is offered again only if Razorpay has no paid attempt
 * on it. The app may have lost Checkout's answer and the webhook may be late:
 * a paid attempt is confirmed now (G1/G2 apply) and the answer is the ticket
 * (409 `already_in_queue`), or the reason it could not be made (refunded).
 */
async function reuseUnlessPaid(
  ctx: PayCtx,
  user: User,
  p: Payment,
): Promise<Payment> {
  const transport = await provider("transport", async () => rzp(ctx));
  const attempts = paidAttempts(
    await provider("order_payments", () =>
      transport.fetchOrderPayments(p.razorpayOrderId),
    ),
  );
  if (attempts.length === 0) return p;
  for (const rp of attempts) {
    await confirmPayment(ctx, p.razorpayOrderId, rp.id, user, rp);
  }
  const after = (await paymentById(ctx.db, p.id)) ?? p;
  // No attempt was really captured (e.g. a held amount that did not match).
  if (!after.razorpayPaymentId) return after;
  await throwIfTicketActive(ctx, after);
  if (after.reason && ALLOCATION_FAILURES.has(after.reason)) {
    throw new AppError(
      409,
      after.reason as ErrorCode,
      "Your earlier payment for this did not get a ticket and is refunded.",
      { paymentId: after.id },
    );
  }
  throw new AppError(409, "invalid_state", "This order is already paid.", {
    paymentId: after.id,
  });
}

/**
 * POST /v1/queues/:id/orders (registered). Reservation: queue open, not
 * full, no active ticket here (`already_in_queue` + `tokenId`), walk-in
 * quota (DO `checkPurchase`). Pass: lane on, not
 * sold out, no active ticket here, pass limit per account and phone.
 */
export async function createOrder(
  ctx: PayCtx,
  user: User,
  queueId: string,
  body: CreateOrderBody,
): Promise<OrderResponse> {
  const { db, env, now } = ctx;
  const names = await namesFor(db, queueId);
  if (names?.queueStatus !== "active" || names.businessStatus !== "active") {
    throw notFound();
  }
  const keyId = await provider("config", async () => razorpayKeyId(env));
  await openTicketInstead(ctx, user, { queueId, kind: body.kind });
  const info = unwrap(
    await queueStub(env, queueId).checkPurchase({
      kind: body.kind,
      userId: user.id,
    }),
  );
  let existing: Payment | null;
  if (body.kind === "priority") {
    existing = await passLimit(
      db,
      {
        queueId,
        userId: user.id,
        deviceHash: body.deviceHash ?? "",
        kind: "priority",
        tokenId: null,
      },
      now,
    );
  } else {
    existing = await reusableOrder(db, user.id, queueId, "reservation", now);
  }
  if (existing) existing = await reuseUnlessPaid(ctx, user, existing);
  const p =
    existing ??
    (await newOrder(ctx, {
      userId: user.id,
      queueId,
      businessId: names.businessId,
      kind: body.kind,
      amountPaise: info.pricePaise,
      deviceHash: body.kind === "priority" ? (body.deviceHash ?? null) : null,
      tokenId: null,
    }));
  return orderResponse(p, keyId, names, info.settings);
}

/** POST /v1/tokens/:id/upgrade (registered, owner of the token): "Skip ahead". */
export async function createUpgradeOrder(
  ctx: PayCtx,
  user: User,
  tokenId: string,
  body: UpgradeBody,
): Promise<OrderResponse> {
  const { db, env, now } = ctx;
  const t = await db.select().from(tokens).where(eq(tokens.id, tokenId)).get();
  if (!t || t.userId !== user.id) throw notFound();
  const names = await namesFor(db, t.queueId);
  if (!names) throw notFound();
  const keyId = await provider("config", async () => razorpayKeyId(env));
  await openTicketInstead(ctx, user, {
    queueId: t.queueId,
    kind: "upgrade",
    tokenId,
  });
  const info = unwrap(
    await queueStub(env, t.queueId).checkPurchase({
      kind: "upgrade",
      userId: user.id,
      tokenId,
    }),
  );
  let existing = await passLimit(
    db,
    {
      queueId: t.queueId,
      userId: user.id,
      deviceHash: body.deviceHash,
      kind: "upgrade",
      tokenId,
    },
    now,
  );
  if (existing) existing = await reuseUnlessPaid(ctx, user, existing);
  const p =
    existing ??
    (await newOrder(ctx, {
      userId: user.id,
      queueId: t.queueId,
      businessId: t.businessId,
      kind: "upgrade",
      amountPaise: info.pricePaise,
      deviceHash: body.deviceHash,
      tokenId,
    }));
  return orderResponse(p, keyId, names, info.settings);
}

// ---------- confirm (PAY-03/04/06, PRI-02, PRI-05) ----------

export interface ConfirmResult {
  payment: Payment;
  token: TokenView | null;
  failure: DoFailure | null;
  /**
   * Set when Razorpay does not report this payment as captured (its status
   * there, or `other_order`): nothing was recorded or allocated.
   */
  notCaptured: string | null;
}

const ALLOCATION_FAILURES = new Set<string>([
  "quota_full",
  "queue_closed",
  "queue_paused",
  "queue_full",
  "already_in_queue",
  "priority_off",
  "sold_out",
  "invalid_state",
  "not_found",
]);

/** One append-only ledger row; the deterministic id makes a retry a no-op. */
function ledgerStmt(
  d1: D1Database,
  p: Pick<Payment, "id" | "businessId">,
  row: [id: string, kind: string, amount: number],
  at: number,
): D1PreparedStatement {
  return d1
    .prepare(
      `INSERT INTO ledger_entries (id, payment_id, business_id, kind, amount_paise, at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    )
    .bind(row[0], p.id, p.businessId, row[1], row[2], at, at);
}

/** Capture ledger rows (deterministic ids): capture + the business/Qpeer split. */
function captureLedger(
  d1: D1Database,
  p: Pick<Payment, "id" | "businessId" | "amountPaise" | "businessSharePct">,
  at: number,
) {
  const s = splitPaise(p.amountPaise, p.businessSharePct);
  const rows: [string, string, number][] = [
    [`capture:${p.id}`, "capture", p.amountPaise],
    [`capture_business:${p.id}`, "business_share", s.business],
    [`capture_platform:${p.id}`, "platform_share", s.platform],
  ];
  return rows.map((r) => ledgerStmt(d1, p, r, at));
}

/**
 * The one place that makes paid tickets (architecture doc §10.2 step 5).
 * Idempotent: client verify, webhook, the 15-min recovery and the daily
 * reconciliation may all call it, in any order and at the same time.
 *
 * 1. Razorpay's own word on the payment: `reported` (signed webhook, Razorpay
 *    API lists) or a fetch (client verify). Only `captured` is money; an
 *    `authorized` payment of the order's amount is captured first (G1).
 * 2. A captured payment of the wrong amount (G4), or a second captured
 *    payment on an order already paid by another one (G2), is a stray:
 *    recorded as its own row and refunded in full.
 * 3. Otherwise it becomes the order's payment → DO allocate / book / upgrade
 *    (each idempotent by the order id) → `allocated`. If the ticket can't be
 *    made (quota filled, queue closed, sold out, ticket no longer WAITING…)
 *    the payment is refunded in full (PAY-06).
 *
 * Null for an unknown order (logged; a later recovery run finds it).
 */
export async function confirmPayment(
  ctx: PayCtx,
  orderId: string,
  razorpayPaymentId: string,
  holder: User | null = null,
  /** Razorpay's payment entity when the caller already has it from Razorpay. */
  reported?: RazorpayPayment,
): Promise<ConfirmResult | null> {
  const { db, env, now } = ctx;
  let p = await paymentByOrder(db, orderId);
  if (!p) {
    logPayment("warn", "confirm_unknown_order", { orderId });
    return null;
  }
  // Recorded as captured before: Razorpay already confirmed it.
  if (p.razorpayPaymentId === razorpayPaymentId) {
    return allocateCaptured(ctx, p, holder);
  }
  const stray = await paymentById(db, strayId(razorpayPaymentId));
  if (stray) {
    await processRefund(ctx, stray.id);
    return strayResult(ctx, p, stray.id, holder);
  }

  const rp =
    reported ??
    (await provider("fetch_payment", async () =>
      rzp(ctx).fetchPayment(razorpayPaymentId),
    ));
  if (rp.id !== razorpayPaymentId || rp.order_id !== orderId) {
    logPayment("error", "payment_order_mismatch", {
      paymentId: p.id,
      razorpayPaymentId,
    });
    return {
      payment: p,
      token: null,
      failure: null,
      notCaptured: "other_order",
    };
  }
  const cap = await ensureCaptured(ctx, p, rp);
  if (!cap) {
    logPayment("warn", "not_captured", {
      paymentId: p.id,
      razorpayPaymentId,
      razorpayStatus: rp.status,
    });
    return { payment: p, token: null, failure: null, notCaptured: rp.status };
  }
  if (cap.amount !== p.amountPaise || (cap.currency ?? "INR") !== "INR") {
    await recordStray(ctx, p, cap, "amount_mismatch");
    return strayResult(ctx, p, strayId(cap.id), holder);
  }

  if (p.razorpayPaymentId === null) {
    // The order's first captured payment becomes its payment. One D1 batch
    // (one transaction): the status change and the capture split. The ledger
    // ids are per order, so a racing second payment writes nothing new.
    const claim = env.DB.prepare(
      `UPDATE payments SET status = 'captured', razorpay_payment_id = ?, updated_at = ?
       WHERE id = ? AND razorpay_payment_id IS NULL
         AND status IN ('created', 'failed', 'expired')`,
    ).bind(cap.id, now, p.id);
    await env.DB.batch([claim, ...captureLedger(env.DB, p, now)]);
    p = (await paymentById(db, p.id)) ?? p;
    if (p.razorpayPaymentId === cap.id) {
      logPayment("info", "captured", { paymentId: p.id, kind: p.kind });
    }
  }
  if (p.razorpayPaymentId !== cap.id) {
    // G2: the order is already paid by another captured payment.
    await recordStray(ctx, p, cap, "duplicate_payment");
    return strayResult(ctx, p, strayId(cap.id), holder);
  }
  return allocateCaptured(ctx, p, holder);
}

/**
 * G1: money counts only when Razorpay says `captured`. An `authorized`
 * payment of the order's amount is captured here (auto-capture off). Null:
 * not money (failed, created, or held for a wrong amount — never captured,
 * Razorpay releases such a hold by itself). A provider error throws 502.
 */
async function ensureCaptured(
  ctx: PayCtx,
  p: Payment,
  rp: RazorpayPayment,
): Promise<RazorpayPayment | null> {
  if (rp.status === "captured") return rp;
  if (rp.status !== "authorized") return null;
  if (rp.amount !== p.amountPaise) {
    logPayment("error", "authorized_amount_mismatch", {
      paymentId: p.id,
      razorpayPaymentId: rp.id,
      amountPaise: rp.amount,
    });
    return null;
  }
  const transport = await provider("transport", async () => rzp(ctx));
  try {
    const c = await transport.capturePayment(rp.id, {
      amount: rp.amount,
      currency: "INR",
    });
    logPayment("info", "capture_requested", {
      paymentId: p.id,
      razorpayPaymentId: rp.id,
    });
    return c.status === "captured" ? c : null;
  } catch (e) {
    // Nothing was asked of Razorpay; the next run captures it.
    if (e instanceof BudgetSpent) throw e;
    // Already captured by a racing call (Razorpay answers 400 then)?
    const again = await provider("fetch_payment", () =>
      transport.fetchPayment(rp.id),
    );
    if (again.status === "captured") return again;
    logPayment("error", "capture_failed", {
      paymentId: p.id,
      razorpayPaymentId: rp.id,
      ...providerFields(e),
    });
    throw new AppError(
      502,
      "payment_provider_error",
      "The payment provider did not answer; try again",
    );
  }
}

/**
 * G2/G4: a captured payment that buys nothing gets its own row (`stray_<id>`,
 * the order's kind, its real amount, status `refund_due`) with its capture
 * split, then a full refund. Ledger: capture + shares, then the refund
 * reverses them, so it nets to zero and shows in both payment histories.
 * Idempotent (deterministic row id, ledger ids and refund receipt).
 */
async function recordStray(
  ctx: PayCtx,
  order: Payment,
  rp: RazorpayPayment,
  reason: StrayReason,
): Promise<void> {
  const { env, now } = ctx;
  const id = strayId(rp.id);
  const row = {
    id,
    businessId: order.businessId,
    amountPaise: rp.amount,
    businessSharePct: order.businessSharePct,
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO payments (id, user_id, queue_id, business_id, token_id, kind,
         amount_paise, business_share_pct, device_hash, razorpay_order_id,
         razorpay_payment_id, status, refund_paise, reason, expires_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, 'refund_due', ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    ).bind(
      id,
      order.userId,
      order.queueId,
      order.businessId,
      order.kind,
      rp.amount,
      order.businessSharePct,
      `${order.razorpayOrderId}:${rp.id}`,
      rp.id,
      rp.amount,
      reason,
      now,
      now,
      now,
    ),
    ...captureLedger(env.DB, row, now),
  ]);
  logPayment("error", reason, {
    paymentId: order.id,
    strayId: id,
    razorpayPaymentId: rp.id,
    amountPaise: rp.amount,
  });
  await processRefund(ctx, id);
}

/**
 * Answer for a stray payment: a duplicate answers with the order's own
 * payment and ticket; a wrong amount with the stray row and a failure.
 */
async function strayResult(
  ctx: PayCtx,
  order: Payment,
  strayRowId: string,
  holder: User | null,
): Promise<ConfirmResult> {
  const s = await paymentById(ctx.db, strayRowId);
  if (s?.reason === "duplicate_payment") {
    const primary = (await paymentById(ctx.db, order.id)) ?? order;
    return allocateCaptured(ctx, primary, holder);
  }
  return {
    payment: s ?? order,
    token: null,
    failure: {
      code: "invalid_state",
      message: "The amount paid did not match the order; it is refunded",
    },
    notCaptured: null,
  };
}

/** Captured order payment → its ticket (DO, idempotent by the order id). */
async function allocateCaptured(
  ctx: PayCtx,
  payment: Payment,
  holder: User | null,
): Promise<ConfirmResult> {
  const { db, env, now } = ctx;
  let p = payment;
  if (p.status !== "captured") return finished(ctx, p, holder);

  const stub = queueStub(env, p.queueId);
  let r: DoResult<TokenView>;
  if (p.kind === "reservation") {
    const a = await stub.allocate({
      method: "remote",
      userId: p.userId,
      cls: "regular",
      paymentOrderId: p.razorpayOrderId,
      paymentId: p.id,
    });
    r = a.ok ? { ok: true, value: a.value.token } : a;
  } else if (p.kind === "priority") {
    const b = await stub.book({
      userId: p.userId,
      paymentOrderId: p.razorpayOrderId,
      paymentId: p.id,
      deviceHash: p.deviceHash,
    });
    r = b.ok ? { ok: true, value: b.value.token } : b;
  } else {
    r = await stub.upgrade({
      tokenId: p.tokenId ?? "",
      paymentOrderId: p.razorpayOrderId,
      paymentId: p.id,
    });
  }

  if (r.ok) {
    await db.run(sql`UPDATE payments SET status = 'allocated', token_id = ${r.value.id},
        updated_at = ${now} WHERE id = ${p.id} AND status = 'captured'`);
    logPayment("info", "allocated", { paymentId: p.id, kind: p.kind });
    p = (await paymentById(db, p.id)) ?? p;
    return {
      payment: p,
      token: await withTicket(env, r.value, holder),
      failure: null,
      notCaptured: null,
    };
  }

  const failure: DoFailure = { code: r.code as ErrorCode, message: r.message };
  await db.run(sql`UPDATE payments SET status = 'refund_due', refund_paise = amount_paise,
      reason = ${r.code}, updated_at = ${now} WHERE id = ${p.id} AND status = 'captured'`);
  logPayment("warn", "allocation_failed", {
    paymentId: p.id,
    kind: p.kind,
    code: r.code,
  });
  await processRefund(ctx, p.id);
  p = (await paymentById(db, p.id)) ?? p;
  return { payment: p, token: null, failure, notCaptured: null };
}

/** Answer for a payment that was already handled. */
async function finished(
  { env }: PayCtx,
  p: Payment,
  holder: User | null,
): Promise<ConfirmResult> {
  const failure: DoFailure | null =
    p.tokenId === null && p.reason && ALLOCATION_FAILURES.has(p.reason)
      ? {
          code: p.reason as ErrorCode,
          message: "No ticket could be made; the payment is refunded",
        }
      : null;
  let token: TokenView | null = null;
  if (p.tokenId) {
    const r = await queueStub(env, p.queueId).getToken(p.tokenId);
    if (r.ok) token = await withTicket(env, r.value.token, holder);
  }
  return { payment: p, token, failure, notCaptured: null };
}

// ---------- refunds (PAY-06/07/09, PRI-09/10) ----------

/** A refund attempt holds the payment this long (racing callers skip it). */
const REFUND_LEASE_MS = 2 * 60_000;
/** Razorpay calls one refund needs at most (list refunds + create one). */
const REFUND_CALLS = 2;
/** After this many failed refund attempts each new failure logs `refund_stuck` (alert). */
export const REFUND_ALERT_AFTER = 3;

/**
 * Wait before the next refund attempt after `failures` failed ones: the next
 * 15-min run, then 15 min, 30 min, 1 h … at most 6 h.
 */
export function refundBackoffMs(failures: number): number {
  if (failures <= 1) return 0;
  return Math.min(15 * 60_000 * 2 ** (failures - 2), 6 * 3_600_000);
}

class RefundBlocked extends Error {}

/** A failed refund attempt: count it, back off, and log (an alert after N). */
async function refundAttemptFailed(
  { db, now }: PayCtx,
  p: Payment,
  failures: number,
  e: unknown,
): Promise<void> {
  await db.run(sql`UPDATE payments SET refund_attempts = ${failures},
      refund_retry_at = ${now + refundBackoffMs(failures)}, updated_at = ${now}
      WHERE id = ${p.id} AND status = 'refund_due'`);
  logPayment(
    "error",
    failures >= REFUND_ALERT_AFTER ? "refund_stuck" : "refund_failed",
    {
      paymentId: p.id,
      failures,
      blocked: e instanceof RefundBlocked ? e.message : null,
      ...providerFields(e),
    },
  );
}

/**
 * Makes the Razorpay refund for a `refund_due` payment, then (one D1 batch)
 * marks it `refunded` and writes the ledger refund + reversed shares.
 * - One attempt at a time: a short lease on `refund_retry_at`; the same
 *   column holds the backoff after a failure (`refundBackoffMs`).
 * - Idempotent: a live (not failed) refund with our receipt (= payment id) is
 *   reused, never a second one.
 * - Never more than captured: the amount is capped at the captured amount
 *   minus Razorpay's other live refunds of this payment.
 * Provider errors leave it `refund_due` for the 15-min cron. Returns true
 * when the payment is now refunded.
 */
export async function processRefund(
  ctx: PayCtx,
  paymentId: string,
): Promise<boolean> {
  const { db, env, now } = ctx;
  const p = await paymentById(db, paymentId);
  if (!p) return false;
  if (p.status !== "refund_due") return p.status === "refunded";
  if (!p.razorpayPaymentId) {
    logPayment("error", "refund_impossible", { paymentId: p.id });
    return false;
  }
  // A refund takes up to 2 calls (list + create): with fewer left in this
  // scheduled run, leave it `refund_due` for the next one (§14).
  if (ctx.budget && !ctx.budget.canAfford(REFUND_CALLS)) return false;
  const lease =
    await db.run(sql`UPDATE payments SET refund_retry_at = ${now + REFUND_LEASE_MS}
      WHERE id = ${p.id} AND status = 'refund_due'
        AND (refund_retry_at IS NULL OR refund_retry_at <= ${now})`);
  if (!lease.meta.changes) return false;
  let refund: RazorpayRefund;
  try {
    const transport = rzp(ctx);
    const live = (await transport.listRefunds(p.razorpayPaymentId)).filter(
      (r) => r.status !== "failed",
    );
    const earlier = live.find((r) => r.receipt === p.id);
    if (earlier) {
      refund = earlier;
    } else {
      const before = live.reduce((sum, r) => sum + r.amount, 0);
      // Whole paise only (Razorpay rejects fractions).
      const want = Math.floor(
        Math.min(p.refundPaise ?? p.amountPaise, p.amountPaise),
      );
      const amount = Math.min(want, p.amountPaise - before);
      if (amount <= 0) throw new RefundBlocked("nothing_left_to_refund");
      if (amount < want) {
        logPayment("error", "refund_capped", {
          paymentId: p.id,
          amountPaise: amount,
          wantedPaise: want,
        });
      }
      refund = await transport.createRefund(p.razorpayPaymentId, {
        amount,
        receipt: p.id,
        notes: { paymentId: p.id, reason: p.reason ?? "refund" },
      });
      if (refund.status === "failed") throw new RefundBlocked("refund_failed");
    }
  } catch (e) {
    if (e instanceof BudgetSpent) {
      // Not a failure: give the lease back so the next run takes it at once.
      const before = p.refundRetryAt ? toMs(p.refundRetryAt) : null;
      await db.run(sql`UPDATE payments SET refund_retry_at = ${before}
          WHERE id = ${p.id} AND status = 'refund_due'`);
      return false;
    }
    await refundAttemptFailed(ctx, p, p.refundAttempts + 1, e);
    return false;
  }
  const amount = refund.amount;
  const back = refundSplit(p.amountPaise, amount, p.businessSharePct);
  const refundStatus = refund.status === "processed" ? "processed" : "pending";
  const rows: [string, string, number][] = [
    [`refund:${p.id}`, "refund", -amount],
    [`refund_business:${p.id}`, "business_share", -back.business],
    [`refund_platform:${p.id}`, "platform_share", -back.platform],
  ];
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE payments SET status = 'refunded', refund_id = ?, refund_paise = ?,
         refund_status = ?, refund_retry_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'refund_due'`,
    ).bind(refund.id, amount, refundStatus, now, p.id),
    ...rows.map((r) => ledgerStmt(env.DB, p, r, now)),
  ]);
  logPayment("info", "refunded", {
    paymentId: p.id,
    amountPaise: amount,
    reason: p.reason,
  });
  // `refund_issued` push (best effort; the ticket screen shows it anyway).
  // In a scheduled run it is skipped once the call budget is used up.
  if (ctx.budget && !ctx.budget.tryTake()) return true;
  try {
    const alert: AlertPush = {
      userId: p.userId,
      tokenId: p.tokenId ?? p.id,
      queueId: p.queueId,
      kind: "refund_issued",
      title: "Refund issued",
      body: `₹${(amount / 100).toFixed(amount % 100 === 0 ? 0 : 2)} is on its way back to you.`,
    };
    await sendAlert(env.DB, pushTransport(env), alert, now);
  } catch {
    // pushes are best effort
  }
  return true;
}

/** Refunds for the given DO outcomes (right after a close or cancel). */
export async function refundOutcomes(
  ctx: PayCtx,
  outcomes: PaidOutcome[],
): Promise<void> {
  for (const o of outcomes) {
    if (o.action !== "refund") continue;
    const p = await paymentByOrder(ctx.db, o.orderId);
    if (p) await processRefund(ctx, p.id);
  }
}

/** Refunds for a token's payments that are due (after a customer cancel). */
export async function refundDueForToken(
  ctx: PayCtx,
  tokenId: string,
): Promise<number> {
  const rows = await ctx.db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(eq(payments.tokenId, tokenId), eq(payments.status, "refund_due")),
    )
    .all();
  let done = 0;
  for (const r of rows) if (await processRefund(ctx, r.id)) done++;
  return done;
}

/**
 * Cron: `refund_due` payments whose backoff is over (oldest first), at most
 * `limit`. A failed attempt moves a payment to the back (`updated_at`). When
 * the run's call budget can't pay for another refund the rest is `deferred`
 * to the next run.
 */
export async function processDueRefunds(
  ctx: PayCtx,
  limit = 20,
): Promise<{ due: number; refunded: number; deferred: number }> {
  const rows = await ctx.db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.status, "refund_due"),
        sql`(${payments.refundRetryAt} IS NULL OR ${payments.refundRetryAt} <= ${ctx.now})`,
      ),
    )
    .orderBy(payments.updatedAt)
    .limit(limit)
    .all();
  let refunded = 0;
  let deferred = 0;
  for (const [i, r] of rows.entries()) {
    if (ctx.budget && !ctx.budget.canAfford(REFUND_CALLS)) {
      deferred = rows.length - i;
      break;
    }
    if (await processRefund(ctx, r.id)) refunded++;
  }
  return { due: rows.length, refunded, deferred };
}

// ---------- webhook-driven updates ----------

/** `payment.failed`: an unpaid order failed (PAY-05). */
export async function markFailed(
  db: Db,
  orderId: string,
  now: number,
  code: string | null,
): Promise<void> {
  await db.run(sql`UPDATE payments SET status = 'failed', reason = ${code ?? "failed"},
      updated_at = ${now} WHERE razorpay_order_id = ${orderId} AND status = 'created'`);
}

/**
 * `refund.processed` / `refund.failed` (PAY-07). A failed refund means the
 * money did not go back: the payment returns to `refund_due` (with backoff)
 * and the 15-min cron makes a new refund (the failed one is ignored then).
 */
export async function markRefund(
  ctx: PayCtx,
  refundId: string,
  status: "processed" | "failed",
): Promise<void> {
  const { db, now } = ctx;
  if (status === "processed") {
    await db.run(sql`UPDATE payments SET refund_status = 'processed', updated_at = ${now}
        WHERE refund_id = ${refundId}`);
    return;
  }
  const p = await db
    .select()
    .from(payments)
    .where(eq(payments.refundId, refundId))
    .get();
  if (!p) return;
  if (p.status !== "refunded") {
    await db.run(sql`UPDATE payments SET refund_status = 'failed', updated_at = ${now}
        WHERE id = ${p.id}`);
    return;
  }
  const failures = p.refundAttempts + 1;
  await db.run(sql`UPDATE payments SET status = 'refund_due', refund_status = 'failed',
      refund_attempts = ${failures}, refund_retry_at = ${now + refundBackoffMs(failures)},
      updated_at = ${now}
      WHERE id = ${p.id} AND status = 'refunded' AND refund_id = ${refundId}`);
  logPayment(
    "error",
    failures >= REFUND_ALERT_AFTER ? "refund_stuck" : "refund_failed",
    { paymentId: p.id, failures, source: "webhook" },
  );
}

/** Cron: unpaid orders past their 30 minutes → `expired`. */
export async function expireStaleOrders(db: Db, now: number): Promise<number> {
  const r =
    await db.run(sql`UPDATE payments SET status = 'expired', updated_at = ${now}
      WHERE status = 'created' AND expires_at < ${now}`);
  return r.meta.changes ?? 0;
}

// ---------- recovery (G3, every 15 min) ----------

export interface RecoverResult {
  stuck: number;
  checked: number;
  confirmed: number;
  errors: number;
  /** Payments left for the next run because the call budget was used up. */
  deferred: number;
}

/** Unpaid orders this young are asked about (late captures included). */
export const RECOVER_WINDOW_MS = 2 * 3_600_000;
/** A captured payment without its ticket this long is retried. */
const STUCK_RETRY_MS = 2 * 60_000;

/**
 * G3: the webhook was lost and the app never called verify (battery died).
 * Every 15 min: (1) captured payments still without a ticket (the DO step or
 * its D1 update failed half-way) are confirmed again; (2) our orders still
 * `created` / `failed` / `expired` from the last 2 h (oldest check first,
 * at most `limit`) are looked up at Razorpay and any paid attempt is
 * confirmed (G1 capture, G2/G4 strays apply). The daily reconcile still
 * compares the whole last day.
 */
export async function recoverRecentOrders(
  ctx: PayCtx,
  limit = 15,
): Promise<RecoverResult> {
  const { db, now } = ctx;
  const out: RecoverResult = {
    stuck: 0,
    checked: 0,
    confirmed: 0,
    errors: 0,
    deferred: 0,
  };
  const stuck = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.status, "captured"),
        lt(payments.updatedAt, new Date(now - STUCK_RETRY_MS)),
      ),
    )
    .orderBy(payments.updatedAt)
    .limit(limit)
    .all();
  // Known captured payments: the DO step needs no Razorpay call (a refund
  // that can't be paid for now stays `refund_due` for the `refunds` job).
  for (const p of stuck) {
    if (!p.razorpayPaymentId) continue;
    try {
      await confirmPayment(ctx, p.razorpayOrderId, p.razorpayPaymentId);
      out.stuck++;
    } catch (e) {
      if (e instanceof BudgetSpent) {
        out.deferred++;
        continue;
      }
      out.errors++;
      logPayment("error", "recover_stuck_failed", {
        paymentId: p.id,
        ...providerFields(e),
      });
    }
  }

  const open = await db
    .select()
    .from(payments)
    .where(
      and(
        inArray(payments.status, ["created", "failed", "expired"]),
        sql`${payments.createdAt} >= ${now - RECOVER_WINDOW_MS}`,
      ),
    )
    .orderBy(payments.updatedAt)
    .limit(limit)
    .all();
  if (open.length === 0) return out;
  let transport: ReturnType<typeof razorpayTransport>;
  try {
    transport = rzp(ctx);
  } catch (e) {
    logPayment("error", "recover_config", providerFields(e));
    return { ...out, errors: out.errors + 1 };
  }
  for (const [i, p] of open.entries()) {
    // Each order needs at least one call; the rest waits for the next run
    // (not rotated, so it is asked first then).
    if (ctx.budget && ctx.budget.left < 1) {
      out.deferred += open.length - i;
      break;
    }
    out.checked++;
    try {
      for (const rp of paidAttempts(
        await transport.fetchOrderPayments(p.razorpayOrderId),
      )) {
        const r = await confirmPayment(ctx, p.razorpayOrderId, rp.id, null, rp);
        if (r && !r.notCaptured) {
          out.confirmed++;
          logPayment("warn", "recovered_payment", {
            paymentId: p.id,
            razorpayPaymentId: rp.id,
          });
        }
      }
      // Rotate: the next run asks about the orders checked longest ago.
      await db.run(sql`UPDATE payments SET updated_at = ${now}
          WHERE id = ${p.id} AND status IN ('created', 'failed', 'expired')`);
    } catch (e) {
      if (e instanceof BudgetSpent) {
        out.checked--;
        out.deferred += open.length - i;
        break;
      }
      out.errors++;
      logPayment("error", "recover_failed", {
        paymentId: p.id,
        ...providerFields(e),
      });
    }
  }
  return out;
}

// ---------- history (PAY-11) ----------

function encodeCursor(p: { createdAt: Date; id: string }): string {
  return btoa(`${toMs(p.createdAt)}:${p.id}`);
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const [ms, id] = atob(cursor).split(":");
    const at = Number(ms);
    if (!Number.isFinite(at) || !id) return null;
    return { at, id };
  } catch {
    return null;
  }
}

function beforeCursor(cursor: string | undefined) {
  const c = decodeCursor(cursor);
  if (cursor && !c) {
    throw new AppError(400, "invalid_input", "Bad cursor");
  }
  return c
    ? or(
        lt(payments.createdAt, new Date(c.at)),
        and(eq(payments.createdAt, new Date(c.at)), lt(payments.id, c.id)),
      )
    : undefined;
}

async function pageWithNames(
  db: Db,
  where: ReturnType<typeof and>,
  limit: number,
) {
  const rows = await db
    .select({
      p: payments,
      queueName: queues.name,
      businessName: businesses.name,
    })
    .from(payments)
    .innerJoin(queues, eq(queues.id, payments.queueId))
    .innerJoin(businesses, eq(businesses.id, payments.businessId))
    .where(where)
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(limit + 1)
    .all();
  const page = rows.slice(0, limit);
  const next =
    rows.length > limit ? encodeCursor(page[page.length - 1].p) : null;
  return { page, next };
}

/** GET /v1/me/payments: the user's payments, newest first (PAY-11). */
export async function myPayments(
  db: Db,
  userId: string,
  q: { limit: number; cursor?: string },
): Promise<{ items: PaymentView[]; nextCursor: string | null }> {
  const { page, next } = await pageWithNames(
    db,
    and(eq(payments.userId, userId), beforeCursor(q.cursor)),
    q.limit,
  );
  return {
    items: page.map((r) => paymentView(r.p, r)),
    nextCursor: next,
  };
}

/**
 * GET /v1/businesses/:id/payments (owner): payments of its queues with the
 * net shares from the ledger. Unpaid/failed/expired orders are left out.
 */
export async function businessPayments(
  db: Db,
  businessId: string,
  q: { limit: number; cursor?: string },
): Promise<{ items: BusinessPaymentView[]; nextCursor: string | null }> {
  const { page, next } = await pageWithNames(
    db,
    and(
      eq(payments.businessId, businessId),
      sql`${payments.status} NOT IN ('created', 'failed', 'expired')`,
      beforeCursor(q.cursor),
    ),
    q.limit,
  );
  const ids = page.map((r) => r.p.id);
  const shares = new Map<string, { b: number; pl: number }>();
  if (ids.length > 0) {
    const rows = await db.all<{
      payment_id: string;
      b: number;
      pl: number;
    }>(sql`SELECT payment_id,
        COALESCE(SUM(CASE WHEN kind = 'business_share' THEN amount_paise END), 0) AS b,
        COALESCE(SUM(CASE WHEN kind = 'platform_share' THEN amount_paise END), 0) AS pl
      FROM ledger_entries WHERE payment_id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}) GROUP BY payment_id`);
    for (const r of rows) shares.set(r.payment_id, { b: r.b, pl: r.pl });
  }
  return {
    items: page.map((r) => ({
      ...paymentView(r.p, r),
      businessSharePaise: shares.get(r.p.id)?.b ?? 0,
      platformSharePaise: shares.get(r.p.id)?.pl ?? 0,
    })),
    nextCursor: next,
  };
}

// ---------- reconciliation (PAY-12, daily cron) ----------

export interface ReconcileResult {
  expired: number;
  retried: number;
  refunds: number;
  providerChecked: number;
  mismatches: number;
  tokensWithoutPayment: number;
  webhookEventsDeleted: number;
  /** Work left undone because the run's call budget was used up (§14). */
  deferred: number;
  /** False when the provider scan stopped early (budget used up or an error). */
  scanComplete: boolean;
}

const STUCK_CAPTURE_MS = 10 * 60_000;
const WEBHOOK_KEEP_MS = 30 * 24 * 3_600_000;

/**
 * §10.4: unpaid orders → expired; captured > 10 min without a token →
 * confirm again (else refund); Razorpay's captured (and authorized) payments
 * of the last day compared with D1: any one that is not the order's recorded
 * payment goes through `confirmPayment` (a missed capture is allocated,
 * PAY-05; a second payment or a wrong amount is refunded as a stray, G2/G4);
 * due refunds; paid tokens without a payment flagged; old
 * webhook ids deleted. Mismatches are logged. With a call `budget` (the
 * scheduled run's) it stops calling Razorpay once that is used up; the D1-only
 * steps still run.
 */
export async function reconcile(
  env: PayEnv,
  db: Db,
  now: number,
  budget?: CallBudget,
): Promise<ReconcileResult> {
  const ctx: PayCtx = { db, env, now, budget };
  const out: ReconcileResult = {
    expired: await expireStaleOrders(db, now),
    retried: 0,
    refunds: 0,
    providerChecked: 0,
    mismatches: 0,
    tokensWithoutPayment: 0,
    webhookEventsDeleted: 0,
    deferred: 0,
    scanComplete: false,
  };
  const stuck = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.status, "captured"),
        lt(payments.updatedAt, new Date(now - STUCK_CAPTURE_MS)),
      ),
    )
    .limit(20)
    .all();
  for (const p of stuck) {
    if (!p.razorpayPaymentId) continue;
    try {
      await confirmPayment(ctx, p.razorpayOrderId, p.razorpayPaymentId);
      out.retried++;
    } catch (e) {
      if (!(e instanceof BudgetSpent)) throw e;
      out.deferred++;
    }
  }
  // The provider scan before the due refunds: in the 21:30 run the `refunds`
  // job has just made them, and the calls kept for reconcile are for this.
  try {
    const transport = rzp(ctx);
    const fromSec = Math.floor((now - 24 * 3_600_000) / 1000);
    const toSec = Math.floor(now / 1000);
    for (let skip = 0; skip < 500; skip += 100) {
      const items = await transport.listPayments({
        fromSec,
        toSec,
        count: 100,
        skip,
      });
      for (const rp of items) {
        if (!PAID_AT_RAZORPAY.has(rp.status) || !rp.order_id) continue;
        out.providerChecked++;
        const p = await paymentByOrder(db, rp.order_id);
        if (!p) {
          out.mismatches++;
          logPayment("error", "reconcile_unknown_payment", {
            razorpayPaymentId: rp.id,
          });
          continue;
        }
        if (p.razorpayPaymentId === rp.id) continue;
        if (await paymentById(db, strayId(rp.id))) continue;
        // A capture we missed, a second payment on a paid order (G2) or a
        // wrong amount (G4): confirmPayment allocates or refunds it.
        out.mismatches++;
        logPayment("warn", "reconcile_missed_payment", {
          paymentId: p.id,
          razorpayPaymentId: rp.id,
        });
        try {
          await confirmPayment(ctx, rp.order_id, rp.id, null, rp);
        } catch (e) {
          if (e instanceof BudgetSpent) {
            // Logged above; found again by tomorrow's scan if still young
            // enough, or by the next order/verify of its user.
            out.deferred++;
            continue;
          }
          logPayment("error", "reconcile_confirm_failed", {
            paymentId: p.id,
            ...providerFields(e),
          });
        }
      }
      if (items.length < 100) {
        out.scanComplete = true;
        break;
      }
    }
  } catch (e) {
    if (e instanceof BudgetSpent) {
      out.deferred++;
    } else {
      logPayment("error", "reconcile_provider", {
        status: e instanceof RazorpayError ? e.status : null,
        config: e instanceof PaymentsConfigError,
      });
    }
  }
  const due = await processDueRefunds(ctx, 20);
  out.refunds = due.refunded;
  out.deferred += due.deferred;

  // Paid tickets whose payment row is missing (or points elsewhere).
  const orphans = await db.all<{ id: string }>(sql`SELECT t.id FROM tokens t
      LEFT JOIN payments p ON p.id = t.payment_id
      WHERE (t.method = 'remote' OR t.series = 'P') AND t.created_at > ${now - 24 * 3_600_000}
        AND (t.payment_id IS NULL OR p.id IS NULL)
      LIMIT 50`);
  out.tokensWithoutPayment = orphans.length;
  for (const o of orphans) {
    logPayment("error", "reconcile_token_without_payment", { tokenId: o.id });
  }

  const del = await db.run(
    sql`DELETE FROM webhook_events WHERE received_at < ${now - WEBHOOK_KEEP_MS}`,
  );
  out.webhookEventsDeleted = del.meta.changes ?? 0;
  return out;
}

/** True when the order exists and belongs to `userId` (verify route). */
export async function paymentOwnedBy(
  db: Db,
  orderId: string,
  userId: string,
): Promise<boolean> {
  const p = await paymentByOrder(db, orderId);
  return p?.userId === userId;
}

/** Queue and business names for a payment view. */
export async function paymentNames(
  db: Db,
  queueId: string,
): Promise<{ queueName: string; businessName: string }> {
  const n = await namesFor(db, queueId);
  return n ?? { queueName: "", businessName: "" };
}
