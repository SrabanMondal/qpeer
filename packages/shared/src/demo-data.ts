import type { BusinessCategory } from "./business";
import {
  istDayStart,
  istLocalTime,
  type Weekday,
  type WeeklyHours,
} from "./hours";
import type { AnalyticsHourRow } from "./insights";
import { refundAmount, refundSplit, splitPaise } from "./payments";

/**
 * Demo history generator (Step 5, DEM-02, DEM-03; HLD §8). Pure and
 * deterministic: the same queues, `seed` and `now` always give the same rows,
 * so a reset re-creates exactly the same history.
 *
 * Shape of the data: weekday peaks per category, a lunch dip, a slow upward
 * trend in visitors, waits that get a little shorter over the weeks,
 * realistic no-shows and leaves, wait estimates right about 75–88 % of the
 * time; a few paid reservations (~3 % of joins) (and passes where the lane is on) with the
 * 70/30 split, some cancelled (refunded) and some forfeited (no-show), as the
 * money rules in architecture doc §10.3 write them.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60_000;

export interface DemoQueueProfile {
  queueId: string;
  businessId: string;
  category: BusinessCategory;
  hours: WeeklyHours;
  /** Average joins per open hour at the start of the history. */
  baseJoinsPerHour: number;
  /** Typical minutes per person at the counter. */
  serviceMin: number;
  reservationFeePaise: number;
  /** Priority Pass price, or null when the queue has no priority lane. */
  priorityFeePaise: number | null;
  /** Share refunded when a pass is cancelled before check-in. */
  priorityCancelRefundPct: number;
}

export interface DemoHistoryOptions {
  now: number;
  /** Weeks of history before today (4–8). */
  weeks: number;
  seed: string;
  businessSharePct: number;
  /** Payment ids are this prefix + a 12-digit counter (UUID-shaped when the prefix is). */
  paymentIdPrefix: string;
  /** `payments.user_id` of every seeded payment (no real person). */
  customerUserId: string;
}

export interface DemoAnalyticsRow extends AnalyticsHourRow {
  queueId: string;
  businessId: string;
}

export interface DemoPayment {
  id: string;
  userId: string;
  queueId: string;
  businessId: string;
  kind: "reservation" | "priority";
  amountPaise: number;
  businessSharePct: number;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  status: "allocated" | "refunded" | "forfeited";
  refundId: string | null;
  refundPaise: number | null;
  refundStatus: "processed" | null;
  reason: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface DemoLedgerRow {
  id: string;
  paymentId: string;
  businessId: string;
  kind: "capture" | "refund" | "forfeit" | "business_share" | "platform_share";
  amountPaise: number;
  at: number;
}

export interface DemoHistory {
  analytics: DemoAnalyticsRow[];
  payments: DemoPayment[];
  ledger: DemoLedgerRow[];
}

/** Small fast PRNG (mulberry32); `hashSeed` turns a string into its state. */
export function makeDemoRng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashSeed(s: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

const WEEKDAY_FACTOR: Record<BusinessCategory, Record<Weekday, number>> = {
  clinic: { mon: 1.3, tue: 1.4, wed: 1.05, thu: 1, fri: 1, sat: 0.9, sun: 0.5 },
  lab: {
    mon: 1.25,
    tue: 1.2,
    wed: 1.1,
    thu: 1.05,
    fri: 1,
    sat: 0.95,
    sun: 0.5,
  },
  service_centre: {
    mon: 1.1,
    tue: 1,
    wed: 1,
    thu: 1,
    fri: 1.05,
    sat: 1.4,
    sun: 0.7,
  },
  salon: {
    mon: 0.7,
    tue: 0.85,
    wed: 0.9,
    thu: 0.95,
    fri: 1.15,
    sat: 1.5,
    sun: 1.4,
  },
  other: { mon: 1.2, tue: 1.05, wed: 1, thu: 1, fri: 1.05, sat: 0.9, sun: 0.6 },
};

/** Relative busyness of an IST hour (morning peak, lunch dip, evening rush). */
export function demoHourShape(
  category: BusinessCategory,
  hour: number,
): number {
  if (category === "clinic" || category === "lab") {
    if (hour < 8) return category === "lab" ? 1.5 : 0.9;
    if (hour < 10) return category === "lab" ? 1.4 : 1.1;
    if (hour < 12) return 1.7;
    if (hour < 13) return 1.15;
    if (hour < 15) return 0.55;
    if (hour < 17) return 0.85;
    if (hour < 19) return 1.15;
    return 0.75;
  }
  if (category === "other") {
    if (hour < 10) return 1.0;
    if (hour < 12) return 1.45;
    if (hour < 13) return 1.1;
    if (hour < 15) return 0.6;
    return 0.9;
  }
  // salon, service centre: slow mornings, evening rush after work
  if (hour < 11) return 0.7;
  if (hour < 13) return 1.0;
  if (hour < 15) return 0.65;
  if (hour < 17) return 0.9;
  if (hour < 20) return 1.5;
  return 1.0;
}

/** IST hours of a day during which any opening range is open. */
function openHours(hours: WeeklyHours, day: Weekday): number[] {
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    const from = `${String(h).padStart(2, "0")}:00`;
    const to = h === 23 ? "24:00" : `${String(h + 1).padStart(2, "0")}:00`;
    if (hours[day].some((r) => r.from < to && r.to > from)) out.push(h);
  }
  return out;
}

const NO_SHOW_BASE: Record<BusinessCategory, number> = {
  clinic: 0.09,
  lab: 0.06,
  service_centre: 0.07,
  salon: 0.08,
  other: 0.06,
};

/**
 * Generates `weeks` weeks of finished IST hours (nothing at or after the
 * current hour) for every queue, plus the payments and ledger rows.
 */
export function generateDemoHistory(
  queues: readonly DemoQueueProfile[],
  opts: DemoHistoryOptions,
): DemoHistory {
  const analytics: DemoAnalyticsRow[] = [];
  const payments: DemoPayment[] = [];
  const ledger: DemoLedgerRow[] = [];
  // Start of the current IST hour (IST is UTC+05:30, so not a UTC hour).
  const today = istDayStart(opts.now);
  const currentHour =
    today + Math.floor((opts.now - today) / HOUR_MS) * HOUR_MS;
  const totalDays = Math.max(1, Math.round(opts.weeks * 7));
  const start = today - totalDays * DAY_MS;
  let payCounter = 0;
  const latest = opts.now - MINUTE_MS;

  for (const q of queues) {
    const rng = makeDemoRng(`${opts.seed}|${q.queueId}`);
    const noise = (spread: number) => 1 - spread + 2 * spread * rng();
    const intRound = (x: number) => Math.max(0, Math.floor(x + rng()));

    for (let d = 0; d <= totalDays; d++) {
      const dayStart = start + d * DAY_MS;
      const progress = d / totalDays;
      const weekday = istLocalTime(dayStart).day;
      const trend = 0.85 + 0.3 * progress;
      const dayMood = noise(0.12);
      for (const hour of openHours(q.hours, weekday)) {
        const hourStart = dayStart + hour * HOUR_MS;
        if (hourStart + HOUR_MS > currentHour) continue;
        const shape = demoHourShape(q.category, hour);
        const expected =
          q.baseJoinsPerHour *
          WEEKDAY_FACTOR[q.category][weekday] *
          shape *
          trend *
          dayMood *
          noise(0.25);
        const joins = intRound(expected);
        const noShowRate =
          NO_SHOW_BASE[q.category] * (1.1 - 0.2 * progress) * noise(0.35);
        const noShows = Math.min(joins, intRound(joins * noShowRate));
        const leaves = Math.min(
          joins - noShows,
          intRound(joins * 0.05 * noise(0.5) * (shape > 1.3 ? 1.6 : 1)),
        );
        const cancels = Math.min(
          joins - noShows - leaves,
          intRound(joins * 0.01 * rng()),
        );
        const served = joins - noShows - leaves - cancels;
        const busy = expected / Math.max(0.1, q.baseJoinsPerHour);
        const waitMin =
          q.serviceMin * (1 + 1.6 * busy) * (1.12 - 0.22 * progress);
        const waits = served + noShows;
        const sumWaitMs = Math.round(waits * waitMin * MINUTE_MS * noise(0.15));
        // As the DO counts them: one wait, ETA sample and interval per call.
        const intervals = Math.max(0, waits - 1);
        const sumIntervalMs = Math.round(
          intervals * q.serviceMin * MINUTE_MS * noise(0.15),
        );
        const etaHits = Math.min(
          waits,
          Math.round(waits * (0.74 + 0.14 * rng())),
        );
        if (joins > 0 || noShows > 0) {
          analytics.push({
            queueId: q.queueId,
            businessId: q.businessId,
            hourStart,
            joins,
            leaves,
            served,
            noShows,
            cancels,
            sumWaitMs,
            waits,
            sumIntervalMs,
            intervals,
            etaHits,
            etaTotal: waits,
          });
        }

        // Paid tickets of this hour: ~3 % reservations, ~1 % passes.
        for (let j = 0; j < joins; j++) {
          let kind: DemoPayment["kind"] | null = null;
          const r = rng();
          if (q.reservationFeePaise >= 100 && r < 0.03) kind = "reservation";
          else if (q.priorityFeePaise !== null && r < 0.04) kind = "priority";
          if (!kind) continue;
          payCounter++;
          const id = `${opts.paymentIdPrefix}${String(payCounter).padStart(12, "0")}`;
          const amount =
            kind === "priority"
              ? (q.priorityFeePaise ?? 0)
              : q.reservationFeePaise;
          const createdAt = Math.min(
            latest,
            hourStart + Math.floor(rng() * 50 * MINUTE_MS),
          );
          const later = (minMin: number, spanMin: number) =>
            Math.max(
              createdAt,
              Math.min(
                latest,
                createdAt + (minMin + Math.floor(rng() * spanMin)) * MINUTE_MS,
              ),
            );
          const outcome = rng();
          const status: DemoPayment["status"] =
            outcome < 0.08
              ? "forfeited"
              : outcome < 0.18
                ? "refunded"
                : "allocated";
          const refundPaise =
            status === "refunded"
              ? kind === "priority"
                ? refundAmount(amount, q.priorityCancelRefundPct)
                : amount
              : null;
          const endAt =
            status === "refunded"
              ? later(10, 50)
              : status === "forfeited"
                ? later(60, 60)
                : createdAt;
          payments.push({
            id,
            userId: opts.customerUserId,
            queueId: q.queueId,
            businessId: q.businessId,
            kind,
            amountPaise: amount,
            businessSharePct: opts.businessSharePct,
            razorpayOrderId: `order_demo_${id}`,
            razorpayPaymentId: `pay_demo_${id}`,
            status,
            refundId: status === "refunded" ? `rfnd_demo_${id}` : null,
            refundPaise,
            refundStatus: status === "refunded" ? "processed" : null,
            reason:
              status === "refunded"
                ? "cancelled"
                : status === "forfeited"
                  ? "no_show"
                  : null,
            createdAt,
            updatedAt: endAt,
            expiresAt: createdAt + 30 * MINUTE_MS,
          });
          const s = splitPaise(amount, opts.businessSharePct);
          const base = { paymentId: id, businessId: q.businessId };
          ledger.push(
            {
              ...base,
              id: `capture:${id}`,
              kind: "capture",
              amountPaise: amount,
              at: createdAt,
            },
            {
              ...base,
              id: `capture_business:${id}`,
              kind: "business_share",
              amountPaise: s.business,
              at: createdAt,
            },
            {
              ...base,
              id: `capture_platform:${id}`,
              kind: "platform_share",
              amountPaise: s.platform,
              at: createdAt,
            },
          );
          if (status === "refunded" && refundPaise !== null) {
            const back = refundSplit(
              amount,
              refundPaise,
              opts.businessSharePct,
            );
            ledger.push(
              {
                ...base,
                id: `refund:${id}`,
                kind: "refund",
                amountPaise: -refundPaise,
                at: endAt,
              },
              {
                ...base,
                id: `refund_business:${id}`,
                kind: "business_share",
                amountPaise: -back.business,
                at: endAt,
              },
              {
                ...base,
                id: `refund_platform:${id}`,
                kind: "platform_share",
                amountPaise: -back.platform,
                at: endAt,
              },
            );
          }
          if (status === "forfeited") {
            ledger.push({
              ...base,
              id: `forfeit:${id}`,
              kind: "forfeit",
              amountPaise: 0,
              at: endAt,
            });
          }
        }
      }
    }
  }
  return { analytics, payments, ledger };
}
