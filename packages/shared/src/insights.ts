import { z } from "zod";
import { STATS_MIN_SAMPLES } from "./business";
import {
  istDayStart,
  istLocalTime,
  WEEKDAYS,
  type Weekday,
  WeekdaySchema,
} from "./hours";
import { PaymentKind, PaymentStatus } from "./payments";

/**
 * Business Insights (Step 5, INS-01…08; HLD §5.1, architecture doc §13).
 * Analytics come from `analytics_hourly` and are computed when requested
 * (no rollup tables); earnings come from the append-only `ledger_entries`.
 * Days are IST days; times are epoch ms; money is integer paise.
 *
 * Everything here is pure: the Worker runs one SQL aggregate and hands the
 * rows to `buildAnalytics`, so the math and the plain-language insights are
 * unit-tested without a database.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 5.5 * HOUR_MS;

// ---------- query ----------

/** INS-01: the two ranges the app offers. */
export const INSIGHTS_RANGES = [7, 28] as const;
export type InsightsRangeDays = (typeof INSIGHTS_RANGES)[number];

/** `?range=7|28` (days, default 7). */
export const InsightsRange = z
  .enum(["7", "28"])
  .default("7")
  .transform((v) => Number(v) as InsightsRangeDays);

/** GET /v1/businesses/:id/analytics query. */
export const AnalyticsQuery = z
  .object({
    range: InsightsRange,
    /** Only this queue (must belong to the business). */
    queueId: z.string().min(1).max(64).optional(),
  })
  .strict();
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

/** GET /v1/businesses/:id/earnings query (the event list is paginated). */
export const EarningsQuery = z
  .object({
    range: InsightsRange,
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type EarningsQuery = z.infer<typeof EarningsQuery>;

const RangeDays = z.union([z.literal(7), z.literal(28)]);
const int = () => z.number().int();

// ---------- shared averages (MAP-05 public stats use the same math) ----------

/** Sums of one or more `analytics_hourly` rows. */
export interface AnalyticsSums {
  joins: number;
  leaves: number;
  served: number;
  noShows: number;
  cancels: number;
  sumWaitMs: number;
  waits: number;
  sumIntervalMs: number;
  intervals: number;
  etaHits: number;
  etaTotal: number;
}

/** One `analytics_hourly` aggregate row: the sums of every queue for one IST hour. */
export interface AnalyticsHourRow extends AnalyticsSums {
  /** Start of the IST hour, epoch ms. */
  hourStart: number;
}

export function emptySums(): AnalyticsSums {
  return {
    joins: 0,
    leaves: 0,
    served: 0,
    noShows: 0,
    cancels: 0,
    sumWaitMs: 0,
    waits: 0,
    sumIntervalMs: 0,
    intervals: 0,
    etaHits: 0,
    etaTotal: 0,
  };
}

function addSums(into: AnalyticsSums, r: AnalyticsSums): void {
  into.joins += r.joins;
  into.leaves += r.leaves;
  into.served += r.served;
  into.noShows += r.noShows;
  into.cancels += r.cancels;
  into.sumWaitMs += r.sumWaitMs;
  into.waits += r.waits;
  into.sumIntervalMs += r.sumIntervalMs;
  into.intervals += r.intervals;
  into.etaHits += r.etaHits;
  into.etaTotal += r.etaTotal;
}

/** Rounded average, or null below `min` samples (never a number from noise). */
export function avgOrNull(sum: number, n: number, min = STATS_MIN_SAMPLES) {
  return n >= min && n > 0 ? Math.round(sum / n) : null;
}

/** Whole percent of `part / whole`, or null below `min` in `whole`. */
export function pctOrNull(
  part: number,
  whole: number,
  min = STATS_MIN_SAMPLES,
) {
  return whole >= min && whole > 0 ? Math.round((part * 100) / whole) : null;
}

/**
 * Average wait, average service time and wait-estimate accuracy (% of
 * actual waits inside the shown range, INS-05) from summed hourly rows.
 * MAP-05's public stats and the owner's analytics both use this.
 */
export function statAverages(
  s: Pick<
    AnalyticsSums,
    | "sumWaitMs"
    | "waits"
    | "sumIntervalMs"
    | "intervals"
    | "etaHits"
    | "etaTotal"
  >,
  min = STATS_MIN_SAMPLES,
): {
  avgWaitMs: number | null;
  avgServiceMs: number | null;
  etaAccuracyPct: number | null;
} {
  return {
    avgWaitMs: avgOrNull(s.sumWaitMs, s.waits, min),
    avgServiceMs: avgOrNull(s.sumIntervalMs, s.intervals, min),
    etaAccuracyPct: pctOrNull(s.etaHits, s.etaTotal, min),
  };
}

// ---------- analytics response ----------

export const AnalyticsTotals = z.object({
  joins: int(),
  served: int(),
  noShows: int(),
  /** People who left the line themselves (LEFT). */
  left: int(),
  /** Paid reservations cancelled by the customer. */
  cancelled: int(),
  avgWaitMs: int().nullable(),
  avgServiceMs: int().nullable(),
  /** INS-05: % of actual waits inside the range the app showed. */
  etaAccuracyPct: int().nullable(),
  /** No-shows ÷ (served + no-shows). */
  noShowPct: int().nullable(),
  /** INS-04: (left + cancelled) ÷ joins — people who gave up waiting. */
  abandonmentPct: int().nullable(),
});
export type AnalyticsTotals = z.infer<typeof AnalyticsTotals>;

/** One IST day of the trend (INS-03). Averages are null below 3 samples. */
export const AnalyticsDay = z.object({
  dayStart: int(),
  /** IST date, `YYYY-MM-DD`. */
  date: z.string(),
  weekday: WeekdaySchema,
  joins: int(),
  served: int(),
  noShows: int(),
  left: int(),
  avgWaitMs: int().nullable(),
  avgServiceMs: int().nullable(),
});
export type AnalyticsDay = z.infer<typeof AnalyticsDay>;

/**
 * INS-02: average joins per weekday × IST hour over the range (each weekday
 * divided by how often it occurs in the range). `fromHour`/`toHour` (end
 * exclusive) frame the hours that had any joins, so the heat strip stays
 * compact; null when nothing happened.
 */
export const PeakHours = z.object({
  days: z.array(
    z.object({
      weekday: WeekdaySchema,
      /** 24 values, index = IST hour; one decimal. */
      avgJoins: z.array(z.number()).length(24),
    }),
  ),
  max: z.number(),
  fromHour: int().nullable(),
  toHour: int().nullable(),
});
export type PeakHours = z.infer<typeof PeakHours>;

export const InsightKind = z.enum(["busiest", "waits", "no_shows", "volume"]);
export type InsightKind = z.infer<typeof InsightKind>;

/** INS-06: one plain-language insight. `tone` colours the card. */
export const Insight = z.object({
  kind: InsightKind,
  tone: z.enum(["good", "bad", "neutral"]),
  text: z.string(),
});
export type Insight = z.infer<typeof Insight>;

export const InsightsQueue = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "archived"]),
});
export type InsightsQueue = z.infer<typeof InsightsQueue>;

/** GET /v1/businesses/:id/analytics (owner and staff). */
export const AnalyticsResponse = z.object({
  businessId: z.string(),
  /** The queue filter, or null for the whole business. */
  queueId: z.string().nullable(),
  rangeDays: RangeDays,
  /** IST midnight that starts the range (the range ends at `to` = now). */
  from: int(),
  to: int(),
  /**
   * INS-08: false until the business has any analytics at all ("Insights
   * appear after your first day of queues"). `firstDataAt` = first hour.
   */
  hasData: z.boolean(),
  firstDataAt: int().nullable(),
  /** The business's queues, for the filter. */
  queues: z.array(InsightsQueue),
  totals: AnalyticsTotals,
  /** The same length of time just before `from`, up to the same time of day. */
  previous: AnalyticsTotals,
  days: z.array(AnalyticsDay),
  peak: PeakHours,
  /** INS-06: 0–3 insights; none when the data is too thin to say anything. */
  insights: z.array(Insight).max(3),
});
export type AnalyticsResponse = z.infer<typeof AnalyticsResponse>;

// ---------- analytics math ----------

/** Daily averages need at least this many samples (else null, a gap in the chart). */
export const DAY_MIN_SAMPLES = 3;
/** Busiest-hours insight: joins in the range needed before saying anything. */
export const INSIGHT_MIN_JOINS = 30;
/** No-show insight: served + no-shows needed in both periods. */
export const INSIGHT_MIN_OUTCOMES = 30;
/** Volume insight: people served needed in both periods. */
export const INSIGHT_MIN_SERVED = 30;
/** The busiest 2-hour window must be this many times the average busy hour. */
export const BUSIEST_FACTOR = 1.5;

/** IST `YYYY-MM-DD` of an IST day start. */
export function istDate(dayStart: number): string {
  return new Date(dayStart + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The range: IST midnight `rangeDays - 1` days before today, up to now. */
export function insightsWindow(
  now: number,
  rangeDays: number,
): { from: number; to: number; previousFrom: number; previousTo: number } {
  const from = istDayStart(now) - (rangeDays - 1) * DAY_MS;
  return {
    from,
    to: now,
    previousFrom: from - rangeDays * DAY_MS,
    // Same time of day: a half-finished today is compared with a
    // half-finished day, never with a whole one.
    previousTo: now - rangeDays * DAY_MS,
  };
}

function totalsOf(s: AnalyticsSums): AnalyticsTotals {
  return {
    joins: s.joins,
    served: s.served,
    noShows: s.noShows,
    left: s.leaves,
    cancelled: s.cancels,
    ...statAverages(s),
    noShowPct: pctOrNull(s.noShows, s.served + s.noShows),
    abandonmentPct: pctOrNull(s.leaves + s.cancels, s.joins),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "12 AM", "9 AM", "12 PM", "5 PM" for an hour 0–24. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${suffix}`;
}

/** "10 AM–12 PM" for the hours [from, to). */
export function hourRangeLabel(from: number, to: number): string {
  return `${hourLabel(from)}–${hourLabel(to)}`;
}

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

function periodLabel(rangeDays: number): string {
  return rangeDays === 7 ? "last week" : `the ${rangeDays / 7} weeks before`;
}

function busiestInsight(
  peak: PeakHours,
  occurrences: Record<Weekday, number>,
  joins: number,
): Insight | null {
  if (joins < INSIGHT_MIN_JOINS) return null;
  let best: { weekday: Weekday; hour: number; value: number } | null = null;
  let busySum = 0;
  let busyCells = 0;
  for (const d of peak.days) {
    for (let h = 0; h < 24; h++) {
      const v = d.avgJoins[h] ?? 0;
      if (v > 0) {
        busySum += v;
        busyCells++;
      }
      if (h === 23) continue;
      const pair = v + (d.avgJoins[h + 1] ?? 0);
      // Strictly greater: ties keep the earlier weekday and hour.
      if (!best || pair > best.value) {
        best = { weekday: d.weekday, hour: h, value: pair };
      }
    }
  }
  if (!best || busyCells === 0) return null;
  const meanBusy = busySum / busyCells;
  if (best.value / 2 < BUSIEST_FACTOR * meanBusy) return null;
  const range = hourRangeLabel(best.hour, best.hour + 2);
  const name = WEEKDAY_NAMES[best.weekday];
  const text =
    occurrences[best.weekday] >= 2
      ? `${name}s ${range} are your busiest hours`
      : `${name} ${range} was your busiest time`;
  return { kind: "busiest", tone: "neutral", text };
}

function waitsInsight(
  cur: AnalyticsSums,
  prev: AnalyticsSums,
  rangeDays: number,
): Insight | null {
  const a = avgOrNull(cur.sumWaitMs, cur.waits);
  const b = avgOrNull(prev.sumWaitMs, prev.waits);
  if (a === null || b === null || b === 0) return null;
  const minutes = Math.round(Math.abs(a - b) / 60_000);
  if (minutes < 1 || Math.abs(a - b) / b < 0.1) return null;
  const shorter = a < b;
  return {
    kind: "waits",
    tone: shorter ? "good" : "bad",
    text: `Your waits got ${minutes} min ${shorter ? "shorter" : "longer"} than ${periodLabel(rangeDays)}`,
  };
}

function noShowInsight(
  cur: AnalyticsSums,
  prev: AnalyticsSums,
  rangeDays: number,
): Insight | null {
  const nc = cur.served + cur.noShows;
  const np = prev.served + prev.noShows;
  if (nc < INSIGHT_MIN_OUTCOMES || np < INSIGHT_MIN_OUTCOMES) return null;
  const rc = cur.noShows / nc;
  const rp = prev.noShows / np;
  if (rp === 0) return null;
  const rel = (rc - rp) / rp;
  if (Math.abs(rel) < 0.2 || Math.abs(rc - rp) < 0.02) return null;
  const up = rel > 0;
  return {
    kind: "no_shows",
    tone: up ? "bad" : "good",
    text: `No-shows are ${up ? "up" : "down"} ${Math.round(Math.abs(rel) * 100)}% vs ${periodLabel(rangeDays)}`,
  };
}

function volumeInsight(
  cur: AnalyticsSums,
  prev: AnalyticsSums,
  rangeDays: number,
): Insight | null {
  if (cur.served < INSIGHT_MIN_SERVED || prev.served < INSIGHT_MIN_SERVED) {
    return null;
  }
  const rel = (cur.served - prev.served) / prev.served;
  if (Math.abs(rel) < 0.15) return null;
  const more = rel > 0;
  return {
    kind: "volume",
    tone: more ? "good" : "neutral",
    text: `You served ${Math.round(Math.abs(rel) * 100)}% ${more ? "more" : "fewer"} people than ${periodLabel(rangeDays)}`,
  };
}

/**
 * Builds the analytics answer from the hourly rows of the range and of the
 * period before it (rows outside both are ignored). Deterministic: the same
 * rows and `now` always give the same answer.
 */
export function buildAnalytics(
  rows: readonly AnalyticsHourRow[],
  opts: { now: number; rangeDays: InsightsRangeDays },
): Pick<
  AnalyticsResponse,
  "from" | "to" | "totals" | "previous" | "days" | "peak" | "insights"
> {
  const { now, rangeDays } = opts;
  const w = insightsWindow(now, rangeDays);
  const cur = emptySums();
  const prev = emptySums();
  const daySums = Array.from({ length: rangeDays }, () => emptySums());
  const occurrences = Object.fromEntries(WEEKDAYS.map((d) => [d, 0])) as Record<
    Weekday,
    number
  >;
  const dayWeekday: Weekday[] = [];
  for (let i = 0; i < rangeDays; i++) {
    const wd = istLocalTime(w.from + i * DAY_MS).day;
    dayWeekday.push(wd);
    occurrences[wd]++;
  }
  const grid = Object.fromEntries(
    WEEKDAYS.map((d) => [d, new Array<number>(24).fill(0)]),
  ) as Record<Weekday, number[]>;

  for (const r of rows) {
    if (r.hourStart >= w.from && r.hourStart <= w.to) {
      addSums(cur, r);
      const i = Math.floor((r.hourStart - w.from) / DAY_MS);
      const day = daySums[i];
      const wd = dayWeekday[i];
      if (!day || !wd) continue;
      addSums(day, r);
      const hour = Math.floor((r.hourStart - (w.from + i * DAY_MS)) / HOUR_MS);
      const cells = grid[wd];
      cells[hour] = (cells[hour] ?? 0) + r.joins;
    } else if (r.hourStart >= w.previousFrom && r.hourStart <= w.previousTo) {
      addSums(prev, r);
    }
  }

  let max = 0;
  let fromHour: number | null = null;
  let toHour: number | null = null;
  const peakDays = WEEKDAYS.map((weekday) => {
    const n = occurrences[weekday];
    const avgJoins = grid[weekday].map((v) => (n > 0 ? round1(v / n) : 0));
    avgJoins.forEach((v, h) => {
      if (v <= 0) return;
      max = Math.max(max, v);
      fromHour = fromHour === null ? h : Math.min(fromHour, h);
      toHour = toHour === null ? h + 1 : Math.max(toHour, h + 1);
    });
    return { weekday, avgJoins };
  });
  const peak: PeakHours = { days: peakDays, max, fromHour, toHour };

  const days: AnalyticsDay[] = daySums.map((s, i) => {
    const dayStart = w.from + i * DAY_MS;
    const avg = statAverages(s, DAY_MIN_SAMPLES);
    return {
      dayStart,
      date: istDate(dayStart),
      weekday: dayWeekday[i] ?? "mon",
      joins: s.joins,
      served: s.served,
      noShows: s.noShows,
      left: s.leaves,
      avgWaitMs: avg.avgWaitMs,
      avgServiceMs: avg.avgServiceMs,
    };
  });

  const insights = [
    busiestInsight(peak, occurrences, cur.joins),
    waitsInsight(cur, prev, rangeDays),
    noShowInsight(cur, prev, rangeDays),
    volumeInsight(cur, prev, rangeDays),
  ]
    .filter((x): x is Insight => x !== null)
    .slice(0, 3);

  return {
    from: w.from,
    to: w.to,
    totals: totalsOf(cur),
    previous: totalsOf(prev),
    days,
    peak,
    insights,
  };
}

// ---------- earnings (INS-07) ----------

export const EarningsTotals = z.object({
  /** Fees captured (reservations, passes, upgrades). */
  capturedPaise: int(),
  /** Refunded to customers (a positive number). */
  refundedPaise: int(),
  /** Fees kept from no-shows (the capture split stands; information only). */
  forfeitedPaise: int(),
  /** Net business share after refunds (ledger `business_share`). */
  businessSharePaise: int(),
  /** Net Qpeer share after refunds (ledger `platform_share`). */
  platformSharePaise: int(),
  /** captured − refunded = business share + Qpeer share. */
  netPaise: int(),
  captures: int(),
  refunds: int(),
  forfeits: int(),
});
export type EarningsTotals = z.infer<typeof EarningsTotals>;

export const EarningsDay = EarningsTotals.extend({
  dayStart: int(),
  date: z.string(),
});
export type EarningsDay = z.infer<typeof EarningsDay>;

export const EarningsEventKind = z.enum(["capture", "refund", "forfeit"]);
export type EarningsEventKind = z.infer<typeof EarningsEventKind>;

/**
 * One money event of one payment, built from its ledger rows: a capture (fee
 * + split), a refund (negative amount + reversed split) or a forfeit (marker,
 * amount 0: the business keeps its share). The list over the whole range adds
 * up exactly to `totals`.
 */
export const EarningsEvent = z.object({
  /** `<kind>:<paymentId>` (one event of each kind per payment at most). */
  id: z.string(),
  kind: EarningsEventKind,
  at: int(),
  paymentId: z.string(),
  paymentKind: PaymentKind,
  paymentStatus: PaymentStatus,
  /** The fee the customer paid. */
  paymentAmountPaise: int(),
  /** Money that moved: + for a capture, − for a refund, 0 for a forfeit. */
  amountPaise: int(),
  businessSharePaise: int(),
  platformSharePaise: int(),
  queueId: z.string(),
  queueName: z.string(),
  tokenId: z.string().nullable(),
});
export type EarningsEvent = z.infer<typeof EarningsEvent>;

/** GET /v1/businesses/:id/earnings (owner). */
export const EarningsResponse = z.object({
  businessId: z.string(),
  rangeDays: RangeDays,
  from: int(),
  to: int(),
  /** INS-08: false until the business has any ledger entry. */
  hasData: z.boolean(),
  firstDataAt: int().nullable(),
  /** The demo split (business keeps this %). */
  businessSharePct: int(),
  totals: EarningsTotals,
  /** Every IST day of the range, oldest first (zero-filled). */
  days: z.array(EarningsDay),
  /** Newest first; `nextCursor` gives the next page of the same range. */
  items: z.array(EarningsEvent),
  nextCursor: z.string().nullable(),
});
export type EarningsResponse = z.infer<typeof EarningsResponse>;

export function emptyEarningsTotals(): EarningsTotals {
  return {
    capturedPaise: 0,
    refundedPaise: 0,
    forfeitedPaise: 0,
    businessSharePaise: 0,
    platformSharePaise: 0,
    netPaise: 0,
    captures: 0,
    refunds: 0,
    forfeits: 0,
  };
}

export function sumEarnings(list: readonly EarningsTotals[]): EarningsTotals {
  const t = emptyEarningsTotals();
  for (const d of list) {
    t.capturedPaise += d.capturedPaise;
    t.refundedPaise += d.refundedPaise;
    t.forfeitedPaise += d.forfeitedPaise;
    t.businessSharePaise += d.businessSharePaise;
    t.platformSharePaise += d.platformSharePaise;
    t.netPaise += d.netPaise;
    t.captures += d.captures;
    t.refunds += d.refunds;
    t.forfeits += d.forfeits;
  }
  return t;
}

/**
 * Zero-filled IST days of the range from per-day sums keyed by IST day start
 * (rows outside the range are ignored).
 */
export function earningsDays(
  byDay: ReadonlyMap<number, EarningsTotals>,
  from: number,
  rangeDays: number,
): EarningsDay[] {
  return Array.from({ length: rangeDays }, (_, i) => {
    const dayStart = from + i * DAY_MS;
    return {
      ...(byDay.get(dayStart) ?? emptyEarningsTotals()),
      dayStart,
      date: istDate(dayStart),
    };
  });
}

/** INS-07 "by week": 7-day blocks of the range, oldest first. */
export function earningsWeeks(
  days: readonly EarningsDay[],
): { weekStart: number; totals: EarningsTotals }[] {
  const out: { weekStart: number; totals: EarningsTotals }[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const block = days.slice(i, i + 7);
    const first = block[0];
    if (!first) continue;
    out.push({ weekStart: first.dayStart, totals: sumEarnings(block) });
  }
  return out;
}
