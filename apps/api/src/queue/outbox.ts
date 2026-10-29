import type {
  EndReason,
  JoinMethod,
  TokenClass,
  TokenSeries,
  TokenState,
} from "@qpeer/shared";
import {
  type AlertPush,
  type PushTransport,
  sendAlert,
  sendAlerts,
} from "../modules/notifications/expo-push";
import type { HourlyCounts, OutboxRow } from "./storage";

/**
 * Durable outbox (architecture doc §9.8). Items are written to DO storage in
 * the same synchronous transaction as the state change, then applied to D1 /
 * Expo by `applyOutboxItem`. Every apply is idempotent, so a retry after a
 * partial failure is harmless.
 */

export interface TokenUpsertPayload {
  id: string;
  queueId: string;
  sessionId: string;
  businessId: string;
  userId: string | null;
  number: number;
  series: TokenSeries;
  cls: TokenClass;
  method: JoinMethod;
  state: TokenState;
  joinedAt: number;
  calledAt: number | null;
  servedAt: number | null;
  endedAt: number | null;
  endReason: EndReason | null;
  paymentId: string | null;
  rev: number;
  at: number;
  /** Absent in items queued before the fix batch. */
  deviceHash?: string | null;
  expiresAt?: number | null;
  /** Step 4 (absent in older items). */
  checkCode?: string | null;
  checkedInAt?: number | null;
  missedAt?: number | null;
}

/**
 * Step 4: the DO decided a paid token's money outcome. Applied to D1
 * `payments` in the row batch (idempotent status transitions):
 * `refund` → `refund_due` with `refund_paise` (the Worker / cron then calls
 * the Razorpay Refunds API); `forfeit` → `forfeited` + a ledger `forfeit`
 * marker (the capture split stands).
 */
export interface PaymentPayload {
  /** Razorpay order id (unique on `payments`). */
  orderId: string;
  tokenId: string;
  action: "refund" | "forfeit";
  /** Refund share, 0–100 (ignored for a forfeit). */
  pct: number;
  reason: string;
  at: number;
}

export interface SnapshotPayload {
  queueId: string;
  businessId: string;
  isOpen: boolean;
  isPaused: boolean;
  waiting: number;
  etaLowMs: number | null;
  etaHighMs: number | null;
  nowServing: string | null;
  updatedAt: number;
  inService?: number;
}

export interface AnalyticsPayload {
  queueId: string;
  businessId: string;
  hourStart: number;
  counts: HourlyCounts;
}

export interface StrikePayload {
  userId: string;
  tokenId: string;
  at: number;
  /** C2: strikes count per device hash too (absent for older items/builds). */
  deviceHash?: string | null;
}

/** Free-lane rule (JON-07): 3 no-shows within 30 days block free joins for 7 days. */
export const STRIKE_LIMIT = 3;
export const STRIKE_WINDOW_MS = 30 * 24 * 3_600_000;
export const STRIKE_BLOCK_MS = 7 * 24 * 3_600_000;

/** Test-only fault injection: fail the next N D1 applies (simulated D1 outage). */
export const outboxFaults = { failD1: 0 };

export interface OutboxDeps {
  d1: D1Database;
  push: PushTransport;
}

/**
 * Row items: plain idempotent upserts (token rows, queue snapshots). They are
 * applied together in one D1 batch, so a burst of N changes costs one D1 round
 * trip instead of N (Step 3.5 finding F2).
 */
export function isRowItem(item: OutboxRow): boolean {
  return (
    item.kind === "token_upsert" ||
    item.kind === "snapshot" ||
    item.kind === "payment"
  );
}

/**
 * Applies row items (see `isRowItem`) in one D1 batch, in outbox order. The
 * batch is one transaction: it applies fully or not at all, and every
 * statement is idempotent, so the caller retries all items on failure.
 */
export async function applyOutboxRows(
  items: OutboxRow[],
  deps: OutboxDeps,
): Promise<void> {
  if (items.length === 0) return;
  if (outboxFaults.failD1 > 0) {
    outboxFaults.failD1--;
    throw new Error("simulated D1 failure");
  }
  const stmts = items.flatMap((item) => {
    const payload = JSON.parse(item.payload);
    if (item.kind === "token_upsert") {
      return [upsertTokenStmt(deps.d1, payload as TokenUpsertPayload)];
    }
    if (item.kind === "snapshot") {
      return [upsertSnapshotStmt(deps.d1, payload as SnapshotPayload)];
    }
    if (item.kind === "payment") {
      return paymentStmts(deps.d1, payload as PaymentPayload);
    }
    throw new Error(`not a row item: ${item.kind}`);
  });
  await deps.d1.batch(stmts);
}

/**
 * Payment decision statements. Guarded by status, so a retry (or a decision
 * that arrives after a webhook moved the payment on) changes nothing.
 */
function paymentStmts(d1: D1Database, p: PaymentPayload) {
  if (p.action === "refund") {
    return [
      d1
        .prepare(
          // CAST: D1 binds the percentage as a REAL, so the division would
          // keep paise fractions (floor, like `refundAmount`).
          `UPDATE payments SET status = 'refund_due',
             refund_paise = CAST((amount_paise * ?) / 100 AS INTEGER), reason = ?, updated_at = ?
           WHERE razorpay_order_id = ? AND status IN ('allocated', 'captured')`,
        )
        .bind(
          Math.min(100, Math.max(0, Math.round(p.pct))),
          p.reason,
          p.at,
          p.orderId,
        ),
    ];
  }
  return [
    d1
      .prepare(
        `UPDATE payments SET status = 'forfeited', reason = ?, updated_at = ?
         WHERE razorpay_order_id = ? AND status = 'allocated'`,
      )
      .bind(p.reason, p.at, p.orderId),
    // Marker entry (amount 0): the capture split stands (§10.3).
    d1
      .prepare(
        `INSERT INTO ledger_entries (id, payment_id, business_id, kind, amount_paise, at, created_at)
         SELECT 'forfeit:' || id, id, business_id, 'forfeit', 0, ?, ?
         FROM payments WHERE razorpay_order_id = ? AND status = 'forfeited'
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(p.at, p.at, p.orderId),
  ];
}

/**
 * Applies push items together (`sendAlerts`: one device lookup, one Expo call).
 * On failure the caller retries all of them; as with a single push, a failure
 * after Expo accepted the messages can repeat them (ALR-04 is best effort).
 */
export async function applyOutboxPushes(
  items: OutboxRow[],
  deps: OutboxDeps,
  now: number,
): Promise<void> {
  const alerts = items.map((i) => JSON.parse(i.payload) as AlertPush);
  await sendAlerts(deps.d1, deps.push, alerts, now);
}

export async function applyOutboxItem(
  item: OutboxRow,
  deps: OutboxDeps,
  now: number,
): Promise<void> {
  if (isRowItem(item)) return applyOutboxRows([item], deps);
  if (item.kind !== "push" && outboxFaults.failD1 > 0) {
    outboxFaults.failD1--;
    throw new Error("simulated D1 failure");
  }
  const payload = JSON.parse(item.payload);
  switch (item.kind) {
    case "token_upsert":
    case "snapshot":
    case "payment":
      return;
    case "analytics":
      return addAnalytics(deps.d1, item.id, payload as AnalyticsPayload, now);
    case "strike":
      return addStrike(deps.d1, item.id, payload as StrikePayload, now);
    case "push":
      await sendAlert(deps.d1, deps.push, payload as AlertPush, now);
      return;
  }
}

/**
 * Upsert by id; only a higher `rev` applies, so a token never moves
 * backwards. Step 4: a pass gets its session and P number at check-in and an
 * upgrade changes the class, so those columns follow too (a check code that
 * was missing on an older row is filled in, never replaced).
 */
function upsertTokenStmt(d1: D1Database, t: TokenUpsertPayload) {
  return d1
    .prepare(
      `INSERT INTO tokens (id, queue_id, session_id, business_id, user_id, number, series, class, method,
         state, joined_at, called_at, served_at, ended_at, end_reason, payment_id, rev, created_at, updated_at,
         device_hash, expires_at, check_code, checked_in_at, missed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state, called_at = excluded.called_at, served_at = excluded.served_at,
         ended_at = excluded.ended_at, end_reason = excluded.end_reason, payment_id = excluded.payment_id,
         rev = excluded.rev, updated_at = excluded.updated_at,
         session_id = excluded.session_id, number = excluded.number, series = excluded.series,
         class = excluded.class, expires_at = excluded.expires_at,
         check_code = COALESCE(tokens.check_code, excluded.check_code),
         checked_in_at = excluded.checked_in_at, missed_at = excluded.missed_at
       WHERE excluded.rev > tokens.rev`,
    )
    .bind(
      t.id,
      t.queueId,
      t.sessionId,
      t.businessId,
      t.userId,
      t.number,
      t.series,
      t.cls,
      t.method,
      t.state,
      t.joinedAt,
      t.calledAt,
      t.servedAt,
      t.endedAt,
      t.endReason,
      t.paymentId,
      t.rev,
      t.at,
      t.at,
      t.deviceHash ?? null,
      t.expiresAt ?? null,
      t.checkCode ?? null,
      t.checkedInAt ?? null,
      t.missedAt ?? null,
    );
}

/** Upsert by queue id with an `updated_at` guard; lat/lng come from the business row. */
function upsertSnapshotStmt(d1: D1Database, s: SnapshotPayload) {
  return d1
    .prepare(
      `INSERT INTO queue_snapshots (queue_id, business_id, lat, lng, is_open, is_paused, waiting,
         eta_low_ms, eta_high_ms, now_serving, updated_at, in_service)
       SELECT ?, ?, b.lat, b.lng, ?, ?, ?, ?, ?, ?, ?, ? FROM businesses b WHERE b.id = ?
       ON CONFLICT(queue_id) DO UPDATE SET
         lat = excluded.lat, lng = excluded.lng, is_open = excluded.is_open, is_paused = excluded.is_paused,
         waiting = excluded.waiting, eta_low_ms = excluded.eta_low_ms, eta_high_ms = excluded.eta_high_ms,
         now_serving = excluded.now_serving, updated_at = excluded.updated_at, in_service = excluded.in_service
       WHERE excluded.updated_at >= queue_snapshots.updated_at`,
    )
    .bind(
      s.queueId,
      s.businessId,
      s.isOpen ? 1 : 0,
      s.isPaused ? 1 : 0,
      s.waiting,
      s.etaLowMs,
      s.etaHighMs,
      s.nowServing,
      s.updatedAt,
      s.inService ?? 0,
      s.businessId,
    );
}

const isDuplicateReceipt = (e: unknown) =>
  e instanceof Error &&
  /UNIQUE constraint failed: outbox_receipts\.id/.test(e.message);

/**
 * Additive upsert keyed by (queue_id, hour_start). The receipt row is inserted
 * in the same batch (one transaction): a duplicate outbox id fails the whole
 * batch, which means this item was applied before.
 */
async function addAnalytics(
  d1: D1Database,
  outboxId: string,
  a: AnalyticsPayload,
  now: number,
) {
  const c = a.counts;
  try {
    await d1.batch([
      d1
        .prepare(
          "INSERT INTO outbox_receipts (id, kind, applied_at) VALUES (?, 'analytics', ?)",
        )
        .bind(outboxId, now),
      d1
        .prepare(
          `INSERT INTO analytics_hourly (queue_id, business_id, hour_start, joins, leaves, served, no_shows,
             cancels, sum_wait_ms, waits, sum_interval_ms, intervals, eta_hits, eta_total, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(queue_id, hour_start) DO UPDATE SET
             joins = joins + excluded.joins, leaves = leaves + excluded.leaves,
             served = served + excluded.served, no_shows = no_shows + excluded.no_shows,
             cancels = cancels + excluded.cancels, sum_wait_ms = sum_wait_ms + excluded.sum_wait_ms,
             waits = waits + excluded.waits, sum_interval_ms = sum_interval_ms + excluded.sum_interval_ms,
             intervals = intervals + excluded.intervals, eta_hits = eta_hits + excluded.eta_hits,
             eta_total = eta_total + excluded.eta_total, updated_at = excluded.updated_at`,
        )
        .bind(
          a.queueId,
          a.businessId,
          a.hourStart,
          c.joins,
          c.leaves,
          c.served,
          c.no_shows,
          c.cancels,
          c.sum_wait_ms,
          c.waits,
          c.sum_interval_ms,
          c.intervals,
          c.eta_hits,
          c.eta_total,
          now,
          now,
        ),
    ]);
  } catch (e) {
    if (!isDuplicateReceipt(e)) throw e;
  }
}

/** Strike row keyed by the outbox id; blocks the user once the limit is reached. */
async function addStrike(
  d1: D1Database,
  outboxId: string,
  s: StrikePayload,
  now: number,
) {
  const until = s.at + STRIKE_BLOCK_MS;
  await d1.batch([
    d1
      .prepare(
        "INSERT INTO free_lane_strikes (id, user_id, token_id, at, created_at, device_hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .bind(outboxId, s.userId, s.tokenId, s.at, now, s.deviceHash ?? null),
    d1
      .prepare(
        `UPDATE users SET free_lane_blocked_until = ?, updated_at = ?
         WHERE id = ?
           AND (free_lane_blocked_until IS NULL OR free_lane_blocked_until < ?)
           AND (SELECT COUNT(*) FROM free_lane_strikes WHERE user_id = ? AND at > ?) >= ?`,
      )
      .bind(
        until,
        now,
        s.userId,
        until,
        s.userId,
        s.at - STRIKE_WINDOW_MS,
        STRIKE_LIMIT,
      ),
  ]);
}
