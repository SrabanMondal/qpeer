import {
  type AnalyticsDay,
  type AnalyticsTotals,
  type EarningsEvent,
  hourRangeLabel,
  type PeakHours,
  WEEKDAY_NAMES,
} from "@qpeer/shared";

import { formatRupees } from "@/lib/format";
import { PAYMENT_KIND_LABELS } from "@/lib/payment-format";
import { formatMinutes } from "@/lib/queue-format";

/** "12 min" or "—" (not enough samples yet). */
export function minutesText(ms: number | null): string {
  return ms === null ? "—" : formatMinutes(ms / 60_000);
}

export function pctText(pct: number | null): string {
  return pct === null ? "—" : `${pct}%`;
}

export type DeltaTone = "good" | "bad" | "neutral";

/** "the week before" / "the 4 weeks before" — what `previous` covers. */
export function periodText(range: number): string {
  return range === 7 ? "last week" : "the 4 weeks before";
}

/**
 * Small "vs before" line under a KPI. `lowerIsBetter` for waits and
 * no-shows. Null when either side has no value or nothing changed.
 */
export function deltaLine(
  cur: number | null,
  prev: number | null,
  o: { unit: "min" | "pct" | "count"; lowerIsBetter: boolean; range: number },
): { text: string; tone: DeltaTone } | null {
  if (cur === null || prev === null) return null;
  let diff = cur - prev;
  let text: string;
  if (o.unit === "min") {
    diff = Math.round(diff / 60_000);
    if (diff === 0) return null;
    text = `${Math.abs(diff)} min ${diff < 0 ? "shorter" : "longer"}`;
  } else if (o.unit === "pct") {
    if (diff === 0) return null;
    text = `${Math.abs(diff)} pts ${diff < 0 ? "lower" : "higher"}`;
  } else {
    if (diff === 0 || prev === 0) return null;
    const rel = Math.round((Math.abs(diff) * 100) / prev);
    if (rel === 0) return null;
    text = `${rel}% ${diff < 0 ? "fewer" : "more"}`;
  }
  const better = o.lowerIsBetter ? diff < 0 : diff > 0;
  return {
    text: `${text} than ${periodText(o.range)}`,
    tone:
      o.unit === "count"
        ? better
          ? "good"
          : "neutral"
        : better
          ? "good"
          : "bad",
  };
}

/** KPI tiles in display order (INS-03…05). */
export function kpis(t: AnalyticsTotals, p: AnalyticsTotals, range: number) {
  return [
    {
      key: "served",
      label: "Served",
      value: String(t.served),
      delta: deltaLine(t.served, p.served, {
        unit: "count",
        lowerIsBetter: false,
        range,
      }),
    },
    {
      key: "wait",
      label: "Average wait",
      value: minutesText(t.avgWaitMs),
      delta: deltaLine(t.avgWaitMs, p.avgWaitMs, {
        unit: "min",
        lowerIsBetter: true,
        range,
      }),
    },
    {
      key: "service",
      label: "Time per person",
      value: minutesText(t.avgServiceMs),
      delta: null,
    },
    {
      key: "noshow",
      label: "No-shows",
      value: pctText(t.noShowPct),
      delta: deltaLine(t.noShowPct, p.noShowPct, {
        unit: "pct",
        lowerIsBetter: true,
        range,
      }),
    },
    {
      key: "eta",
      label: "Wait estimates right",
      value: pctText(t.etaAccuracyPct),
      delta: null,
    },
  ] as const;
}

/** "Mon 9" for a chart label (IST date of the day). */
export function dayLabel(d: Pick<AnalyticsDay, "date">): string {
  const [, , day] = d.date.split("-");
  const wd = new Date(`${d.date}T00:00:00Z`).getUTCDay();
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[wd]} ${Number(day)}`;
}

/** "9 Nov" for a week start. */
export function shortDate(date: string): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const [, m, d] = date.split("-");
  return `${Number(d)} ${months[Number(m) - 1]}`;
}

/** Screen-reader summary of a weekday row of the heat strip. */
export function peakRowLabel(
  row: PeakHours["days"][number],
  from: number,
  to: number,
): string {
  let best = -1;
  let bestV = 0;
  for (let h = from; h < to; h++) {
    const v = row.avgJoins[h] ?? 0;
    if (v > bestV) {
      bestV = v;
      best = h;
    }
  }
  const name = WEEKDAY_NAMES[row.weekday];
  return best < 0
    ? `${name}: no visits`
    : `${name}: busiest ${hourRangeLabel(best, best + 1)}, about ${bestV} joins`;
}

/** One earnings event in plain words. */
export function eventTitle(e: EarningsEvent): string {
  const kind = PAYMENT_KIND_LABELS[e.paymentKind];
  if (e.kind === "capture") return `${kind} paid`;
  if (e.kind === "refund") return `${kind} refunded`;
  return `${kind}: no-show, fee kept`;
}

/** Signed money text: "+₹20", "−₹20", "₹0". */
export function signedRupees(paise: number): string {
  if (paise === 0) return formatRupees(0);
  return `${paise > 0 ? "+" : "−"}${formatRupees(Math.abs(paise))}`;
}
