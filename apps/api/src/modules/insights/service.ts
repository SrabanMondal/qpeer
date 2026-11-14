import {
  type AnalyticsHourRow,
  type AnalyticsQuery,
  type AnalyticsResponse,
  buildAnalytics,
  DEMO_BUSINESS_SHARE_PCT,
  type EarningsEvent,
  type EarningsQuery,
  type EarningsResponse,
  type EarningsTotals,
  earningsDays,
  type InsightsQueue,
  insightsWindow,
  type PaymentKind,
  type PaymentStatus,
  sumEarnings,
} from "@qpeer/shared";
import { AppError, notFound } from "../../lib/errors";

/**
 * Business Insights (Step 5, INS-01…08; architecture doc §13). Computed on
 * read: analytics from `analytics_hourly`, earnings from the append-only
 * `ledger_entries`. Each request is one D1 batch (one round trip) of a few
 * aggregate statements on idx(business_id, hour_start) / idx(business_id, at);
 * the math lives in shared pure helpers.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 5.5 * HOUR_MS;

// ---------- analytics ----------

const SUMS = `SUM(joins) AS joins, SUM(leaves) AS leaves, SUM(served) AS served,
  SUM(no_shows) AS noShows, SUM(cancels) AS cancels, SUM(sum_wait_ms) AS sumWaitMs,
  SUM(waits) AS waits, SUM(sum_interval_ms) AS sumIntervalMs, SUM(intervals) AS intervals,
  SUM(eta_hits) AS etaHits, SUM(eta_total) AS etaTotal`;

/**
 * GET /v1/businesses/:id/analytics. One batch: the hourly sums of the range
 * and of the period before it (all queues, or one), the first analytics hour
 * ever (INS-08) and the queue list (filter + IDOR check of `queueId`).
 */
export async function businessAnalytics(
  d1: D1Database,
  businessId: string,
  q: AnalyticsQuery,
  now: number,
): Promise<AnalyticsResponse> {
  const w = insightsWindow(now, q.range);
  const rowsStmt = q.queueId
    ? d1
        .prepare(
          `SELECT hour_start AS hourStart, ${SUMS} FROM analytics_hourly
           WHERE business_id = ? AND queue_id = ? AND hour_start >= ? AND hour_start <= ?
           GROUP BY hour_start`,
        )
        .bind(businessId, q.queueId, w.previousFrom, w.to)
    : d1
        .prepare(
          `SELECT hour_start AS hourStart, ${SUMS} FROM analytics_hourly
           WHERE business_id = ? AND hour_start >= ? AND hour_start <= ?
           GROUP BY hour_start`,
        )
        .bind(businessId, w.previousFrom, w.to);
  const [rows, first, qs] = await d1.batch<unknown>([
    rowsStmt,
    d1
      .prepare(
        "SELECT MIN(hour_start) AS first FROM analytics_hourly WHERE business_id = ?",
      )
      .bind(businessId),
    d1
      .prepare(
        "SELECT id, name, status FROM queues WHERE business_id = ? ORDER BY created_at, id",
      )
      .bind(businessId),
  ]);
  const queues = (qs?.results ?? []) as InsightsQueue[];
  // A queue of another business is "not found", never its data (IDOR).
  if (q.queueId && !queues.some((x) => x.id === q.queueId)) throw notFound();
  const firstDataAt =
    (first?.results?.[0] as { first: number | null } | undefined)?.first ??
    null;
  const built = buildAnalytics((rows?.results ?? []) as AnalyticsHourRow[], {
    now,
    rangeDays: q.range,
  });
  return {
    businessId,
    queueId: q.queueId ?? null,
    rangeDays: q.range,
    hasData: firstDataAt !== null,
    firstDataAt,
    queues: queues.map((x) => ({ id: x.id, name: x.name, status: x.status })),
    ...built,
  };
}

// ---------- earnings ----------

interface DayRow {
  d: number;
  captured: number;
  refunded: number;
  b: number;
  pl: number;
  captures: number;
  refunds: number;
  forfeits: number;
  forfeited: number;
}

interface EventRow {
  paymentId: string;
  ev: "capture" | "refund" | "forfeit";
  at: number;
  amount: number;
  b: number;
  pl: number;
  paymentKind: PaymentKind;
  paymentStatus: PaymentStatus;
  paymentAmount: number;
  queueId: string;
  queueName: string;
  tokenId: string | null;
}

/**
 * Ledger rows grouped into money events. Ledger ids are deterministic
 * (`capture:<id>`, `capture_business:<id>`, `refund:<id>`, `refund_business:<id>`,
 * `forfeit:<id>`…, architecture §23 "Ledger ids"), so the id prefix says which
 * event a share row belongs to.
 */
const EVENTS_SQL = `SELECT e.payment_id AS paymentId, e.ev AS ev, e.at AS at, e.amount AS amount,
    e.b AS b, e.pl AS pl, p.kind AS paymentKind, p.status AS paymentStatus,
    p.amount_paise AS paymentAmount, p.queue_id AS queueId, p.token_id AS tokenId,
    COALESCE(q.name, '') AS queueName
  FROM (
    SELECT l.payment_id,
      CASE WHEN substr(l.id, 1, 7) = 'capture' THEN 'capture'
           WHEN substr(l.id, 1, 6) = 'refund' THEN 'refund'
           ELSE 'forfeit' END AS ev,
      MAX(l.at) AS at,
      SUM(CASE WHEN l.kind IN ('capture', 'refund') THEN l.amount_paise ELSE 0 END) AS amount,
      SUM(CASE WHEN l.kind = 'business_share' THEN l.amount_paise ELSE 0 END) AS b,
      SUM(CASE WHEN l.kind = 'platform_share' THEN l.amount_paise ELSE 0 END) AS pl
    FROM ledger_entries l
    WHERE l.business_id = ? AND l.at >= ? AND l.at <= ?
    GROUP BY l.payment_id, ev
  ) e
  JOIN payments p ON p.id = e.payment_id
  LEFT JOIN queues q ON q.id = p.queue_id
  WHERE (? IS NULL OR e.at < ? OR (e.at = ? AND (e.ev || ':' || e.payment_id) < ?))
  ORDER BY e.at DESC, (e.ev || ':' || e.payment_id) DESC
  LIMIT ?`;

const DAYS_SQL = `SELECT ((l.at + ${IST_OFFSET_MS}) / ${DAY_MS}) AS d,
    SUM(CASE WHEN l.kind = 'capture' THEN l.amount_paise ELSE 0 END) AS captured,
    SUM(CASE WHEN l.kind = 'refund' THEN -l.amount_paise ELSE 0 END) AS refunded,
    SUM(CASE WHEN l.kind = 'business_share' THEN l.amount_paise ELSE 0 END) AS b,
    SUM(CASE WHEN l.kind = 'platform_share' THEN l.amount_paise ELSE 0 END) AS pl,
    SUM(CASE WHEN l.kind = 'capture' THEN 1 ELSE 0 END) AS captures,
    SUM(CASE WHEN l.kind = 'refund' THEN 1 ELSE 0 END) AS refunds,
    SUM(CASE WHEN l.kind = 'forfeit' THEN 1 ELSE 0 END) AS forfeits,
    SUM(CASE WHEN l.kind = 'forfeit' THEN
      COALESCE((SELECT p.amount_paise FROM payments p WHERE p.id = l.payment_id), 0)
      ELSE 0 END) AS forfeited
  FROM ledger_entries l
  WHERE l.business_id = ? AND l.at >= ? AND l.at <= ?
  GROUP BY d`;

interface Cursor {
  at: number;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return btoa(JSON.stringify([c.at, c.id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeCursor(s: string | undefined): Cursor | null {
  if (s === undefined) return null;
  try {
    const [at, id] = JSON.parse(
      atob(s.replace(/-/g, "+").replace(/_/g, "/")),
    ) as unknown[];
    if (
      typeof at === "number" &&
      Number.isSafeInteger(at) &&
      typeof id === "string"
    ) {
      return { at, id };
    }
  } catch {
    // fall through
  }
  throw new AppError(400, "invalid_input", "Bad cursor");
}

function dayTotals(r: DayRow): EarningsTotals {
  return {
    capturedPaise: r.captured,
    refundedPaise: r.refunded,
    forfeitedPaise: r.forfeited,
    businessSharePaise: r.b,
    platformSharePaise: r.pl,
    netPaise: r.captured - r.refunded,
    captures: r.captures,
    refunds: r.refunds,
    forfeits: r.forfeits,
  };
}

/**
 * GET /v1/businesses/:id/earnings. One batch: per-IST-day sums of the ledger
 * in the range, one page of money events (newest first) and the first ledger
 * entry ever. Every page carries the same totals; the events of all pages add
 * up to them exactly (captures − refunds = net = business + Qpeer share).
 */
export async function businessEarnings(
  d1: D1Database,
  businessId: string,
  q: EarningsQuery,
  now: number,
): Promise<EarningsResponse> {
  const w = insightsWindow(now, q.range);
  const c = decodeCursor(q.cursor);
  const [daysRes, eventsRes, firstRes] = await d1.batch<unknown>([
    d1.prepare(DAYS_SQL).bind(businessId, w.from, w.to),
    d1
      .prepare(EVENTS_SQL)
      .bind(
        businessId,
        w.from,
        w.to,
        c?.at ?? null,
        c?.at ?? null,
        c?.at ?? null,
        c?.id ?? null,
        q.limit + 1,
      ),
    d1
      .prepare(
        "SELECT MIN(at) AS first FROM ledger_entries WHERE business_id = ?",
      )
      .bind(businessId),
  ]);
  const byDay = new Map<number, EarningsTotals>();
  for (const r of (daysRes?.results ?? []) as DayRow[]) {
    byDay.set(r.d * DAY_MS - IST_OFFSET_MS, dayTotals(r));
  }
  const days = earningsDays(byDay, w.from, q.range);
  const rows = (eventsRes?.results ?? []) as EventRow[];
  const page = rows.slice(0, q.limit);
  const items: EarningsEvent[] = page.map((r) => ({
    id: `${r.ev}:${r.paymentId}`,
    kind: r.ev,
    at: r.at,
    paymentId: r.paymentId,
    paymentKind: r.paymentKind,
    paymentStatus: r.paymentStatus,
    paymentAmountPaise: r.paymentAmount,
    amountPaise: r.amount,
    businessSharePaise: r.b,
    platformSharePaise: r.pl,
    queueId: r.queueId,
    queueName: r.queueName,
    tokenId: r.tokenId,
  }));
  const last = items[items.length - 1];
  const firstDataAt =
    (firstRes?.results?.[0] as { first: number | null } | undefined)?.first ??
    null;
  return {
    businessId,
    rangeDays: q.range,
    from: w.from,
    to: w.to,
    hasData: firstDataAt !== null,
    firstDataAt,
    businessSharePct: DEMO_BUSINESS_SHARE_PCT,
    totals: sumEarnings(days),
    days,
    items,
    nextCursor:
      rows.length > q.limit && last
        ? encodeCursor({ at: last.at, id: last.id })
        : null,
  };
}
