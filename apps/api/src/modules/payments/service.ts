import {
  type BusinessPaymentView,
  type CreateOrderBody,
  DEMO_BUSINESS_SHARE_PCT,
  type ErrorCode,
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
  razorpayKeyId,
  razorpayTransport,
} from "./razorpay";

/**
 * Payments (Step 4, architecture doc §10; HLD §6.3). Rules:
 * - Amounts come from the queue settings, never from the app.
 * - `confirmPayment` (client verify, webhook, reconciliation) is idempotent
 *   and the only place that makes paid tickets.
 * - The ledger is append-only; each entry has a deterministic id, so a
 *   retry can never write it twice.
 * - Status transitions are guarded in SQL (`WHERE status = …`).
 */

export type PayEnv = Pick<Bindings, "QUEUE" | "DB"> &
  RazorpayEnv &
  TicketEnv & { ENVIRONMENT?: string; EXPO_ACCESS_TOKEN?: string };

export interface PayCtx {
  db: Db;
  env: PayEnv;
  now: number;
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
  { db, env, now }: PayCtx,
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
    razorpayTransport(env),
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

/**
 * POST /v1/queues/:id/orders (registered). Reservation: queue open, not
 * full, paid cap, walk-in quota (DO `checkPurchase`). Pass: lane on, not
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
  const info = unwrap(
    await queueStub(env, t.queueId).checkPurchase({
      kind: "upgrade",
      userId: user.id,
      tokenId,
    }),
  );
  const existing = await passLimit(
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
}

const DONE = new Set(["allocated", "refund_due", "refunded", "forfeited"]);
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
  p: Payment,
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
function captureLedger(d1: D1Database, p: Payment, at: number) {
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
 * Idempotent: client verify, webhook and reconciliation may all call it, in
 * any order and at the same time. Captured → DO allocate / book / upgrade
 * (each idempotent by the order id) → `allocated`. If the ticket can't be
 * made (quota filled, queue closed, sold out, ticket no longer WAITING…) the
 * payment is refunded in full (PAY-06). Null for an unknown order.
 */
export async function confirmPayment(
  ctx: PayCtx,
  orderId: string,
  razorpayPaymentId: string,
  holder: User | null = null,
  /** Amount Razorpay reports (webhook); a mismatch is flagged, never allocated. */
  reportedAmount?: number,
): Promise<ConfirmResult | null> {
  const { db, env, now } = ctx;
  let p = await paymentByOrder(db, orderId);
  if (!p) {
    logPayment("warn", "confirm_unknown_order", { orderId });
    return null;
  }
  if (reportedAmount !== undefined && reportedAmount !== p.amountPaise) {
    logPayment("error", "amount_mismatch", { paymentId: p.id });
    return null;
  }
  if (DONE.has(p.status)) return finished(ctx, p, holder);

  if (p.status !== "captured") {
    // One D1 batch (one transaction): the status change and the capture split.
    const capture = env.DB.prepare(
      `UPDATE payments SET status = 'captured',
         razorpay_payment_id = COALESCE(razorpay_payment_id, ?), updated_at = ?
       WHERE id = ? AND status IN ('created', 'failed', 'expired')`,
    ).bind(razorpayPaymentId, now, p.id);
    await env.DB.batch([capture, ...captureLedger(env.DB, p, now)]);
    logPayment("info", "captured", { paymentId: p.id, kind: p.kind });
  }
  p = (await paymentById(db, p.id)) ?? p;
  if (DONE.has(p.status)) return finished(ctx, p, holder);

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
  return { payment: p, token: null, failure };
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
  return { payment: p, token, failure };
}

// ---------- refunds (PAY-06/07/09, PRI-09/10) ----------

/**
 * Makes the Razorpay refund for a `refund_due` payment, then (one D1 batch)
 * marks it `refunded` and writes the ledger refund + reversed shares.
 * Idempotent: a refund with our receipt (= payment id) is looked up before a
 * new one is created. Provider errors leave it `refund_due` for the cron.
 * Returns true when the payment is now refunded.
 */
export async function processRefund(
  { db, env, now }: PayCtx,
  paymentId: string,
): Promise<boolean> {
  const p = await paymentById(db, paymentId);
  if (!p) return false;
  if (p.status !== "refund_due") return p.status === "refunded";
  const amount = p.refundPaise ?? p.amountPaise;
  if (!p.razorpayPaymentId || amount <= 0) {
    logPayment("error", "refund_impossible", { paymentId: p.id, amount });
    return false;
  }
  let refund: { id: string; status: string };
  try {
    const transport = razorpayTransport(env);
    const earlier = (await transport.listRefunds(p.razorpayPaymentId)).find(
      (r) => r.receipt === p.id,
    );
    refund =
      earlier ??
      (await transport.createRefund(p.razorpayPaymentId, {
        amount,
        receipt: p.id,
        notes: { paymentId: p.id, reason: p.reason ?? "refund" },
      }));
  } catch (e) {
    logPayment("error", "refund_failed", {
      paymentId: p.id,
      status: e instanceof RazorpayError ? e.status : null,
      code: e instanceof RazorpayError ? e.code : null,
      config: e instanceof PaymentsConfigError,
    });
    return false;
  }
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
         refund_status = ?, updated_at = ?
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

/** Cron: every `refund_due` payment (oldest first), at most `limit`. */
export async function processDueRefunds(
  ctx: PayCtx,
  limit = 20,
): Promise<{ due: number; refunded: number }> {
  const rows = await ctx.db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.status, "refund_due"))
    .orderBy(payments.updatedAt)
    .limit(limit)
    .all();
  let refunded = 0;
  for (const r of rows) if (await processRefund(ctx, r.id)) refunded++;
  return { due: rows.length, refunded };
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

/** `refund.processed` / `refund.failed` (PAY-07). */
export async function markRefund(
  db: Db,
  refundId: string,
  status: "processed" | "failed",
  now: number,
): Promise<void> {
  await db.run(sql`UPDATE payments SET refund_status = ${status}, updated_at = ${now}
      WHERE refund_id = ${refundId}`);
}

/** Cron: unpaid orders past their 30 minutes → `expired`. */
export async function expireStaleOrders(db: Db, now: number): Promise<number> {
  const r =
    await db.run(sql`UPDATE payments SET status = 'expired', updated_at = ${now}
      WHERE status = 'created' AND expires_at < ${now}`);
  return r.meta.changes ?? 0;
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
}

const STUCK_CAPTURE_MS = 10 * 60_000;
const WEBHOOK_KEEP_MS = 30 * 24 * 3_600_000;

/**
 * §10.4: unpaid orders → expired; captured > 10 min without a token →
 * confirm again (else refund); due refunds; Razorpay's captured payments of
 * the last day compared with D1 (a captured payment we missed is confirmed,
 * PAY-05); paid tokens without a payment flagged; old webhook ids deleted.
 * Mismatches are logged as errors.
 */
export async function reconcile(
  env: PayEnv,
  db: Db,
  now: number,
): Promise<ReconcileResult> {
  const ctx: PayCtx = { db, env, now };
  const out: ReconcileResult = {
    expired: await expireStaleOrders(db, now),
    retried: 0,
    refunds: 0,
    providerChecked: 0,
    mismatches: 0,
    tokensWithoutPayment: 0,
    webhookEventsDeleted: 0,
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
    await confirmPayment(ctx, p.razorpayOrderId, p.razorpayPaymentId);
    out.retried++;
  }
  out.refunds = (await processDueRefunds(ctx, 20)).refunded;

  try {
    const transport = razorpayTransport(env);
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
        if (rp.status !== "captured" || !rp.order_id) continue;
        out.providerChecked++;
        const p = await paymentByOrder(db, rp.order_id);
        if (!p) {
          out.mismatches++;
          logPayment("error", "reconcile_unknown_payment", {
            razorpayPaymentId: rp.id,
          });
          continue;
        }
        if (p.amountPaise !== rp.amount) {
          out.mismatches++;
          logPayment("error", "reconcile_amount", { paymentId: p.id });
          continue;
        }
        if (
          p.status === "created" ||
          p.status === "failed" ||
          p.status === "expired"
        ) {
          out.mismatches++;
          logPayment("warn", "reconcile_missed_capture", { paymentId: p.id });
          await confirmPayment(ctx, rp.order_id, rp.id);
        }
      }
      if (items.length < 100) break;
    }
  } catch (e) {
    logPayment("error", "reconcile_provider", {
      status: e instanceof RazorpayError ? e.status : null,
      config: e instanceof PaymentsConfigError,
    });
  }

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
