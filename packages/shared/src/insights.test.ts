import { describe, expect, it } from "vitest";
import { STATS_MIN_SAMPLES } from "./business";
import {
  type AnalyticsHourRow,
  AnalyticsResponse,
  buildAnalytics,
  earningsDays,
  earningsWeeks,
  emptyEarningsTotals,
  emptySums,
  hourLabel,
  hourRangeLabel,
  InsightsRange,
  insightsWindow,
  statAverages,
  sumEarnings,
} from "./insights";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Epoch ms of an IST wall-clock time. Month is 1-based. */
function ist(y: number, mo: number, d: number, h = 0, mi = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi) - 5.5 * HOUR;
}

/** Thursday 12 Nov 2026, 3:30 PM IST. */
const NOW = ist(2026, 11, 12, 15, 30);

function row(
  hourStart: number,
  r: Partial<Omit<AnalyticsHourRow, "hourStart">> = {},
): AnalyticsHourRow {
  return { ...emptySums(), hourStart, ...r };
}

/** A row where `n` people joined and were all served with `waitMin` waits. */
function served(hourStart: number, n: number, waitMin = 10, noShows = 0) {
  return row(hourStart, {
    joins: n + noShows,
    served: n,
    noShows,
    waits: n + noShows,
    sumWaitMs: (n + noShows) * waitMin * 60_000,
    intervals: n,
    sumIntervalMs: n * 4 * 60_000,
    etaHits: n,
    etaTotal: n + noShows,
  });
}

function full(rows: AnalyticsHourRow[], rangeDays: 7 | 28 = 7) {
  const r = buildAnalytics(rows, { now: NOW, rangeDays });
  // The pieces must fit the response contract.
  AnalyticsResponse.parse({
    ...r,
    businessId: "b",
    queueId: null,
    rangeDays,
    hasData: rows.length > 0,
    firstDataAt: null,
    queues: [],
  });
  return r;
}

describe("insights window and query (INS-01)", () => {
  it("range is 7 or 28, default 7", () => {
    expect(InsightsRange.parse(undefined)).toBe(7);
    expect(InsightsRange.parse("28")).toBe(28);
    expect(InsightsRange.safeParse("14").success).toBe(false);
  });

  it("starts at IST midnight range-1 days ago; previous period stops at the same time of day", () => {
    const w = insightsWindow(NOW, 7);
    expect(w.from).toBe(ist(2026, 11, 6));
    expect(w.to).toBe(NOW);
    expect(w.previousFrom).toBe(ist(2026, 10, 30));
    expect(w.previousTo).toBe(NOW - 7 * DAY);
  });

  it("empty data: zero counts, null averages, every day present, no insights", () => {
    const r = full([]);
    expect(r.days).toHaveLength(7);
    expect(r.days[0]).toMatchObject({ date: "2026-11-06", weekday: "fri" });
    expect(r.days[6]).toMatchObject({ date: "2026-11-12", weekday: "thu" });
    expect(r.totals).toEqual({
      joins: 0,
      served: 0,
      noShows: 0,
      left: 0,
      cancelled: 0,
      avgWaitMs: null,
      avgServiceMs: null,
      etaAccuracyPct: null,
      noShowPct: null,
      abandonmentPct: null,
    });
    expect(r.peak).toMatchObject({ max: 0, fromHour: null, toHour: null });
    expect(r.insights).toEqual([]);
  });
});

describe("totals, days and peak hours (INS-02, INS-03, INS-04, INS-05)", () => {
  it("buckets by IST day and hour; ignores rows outside both periods", () => {
    const r = full([
      served(ist(2026, 11, 12, 9), 12, 10), // today 9 AM
      served(ist(2026, 11, 6, 0), 3, 10), // first minute of the range
      served(ist(2026, 11, 5, 9), 50, 10), // previous period
      served(ist(2026, 10, 29, 23), 99, 10), // before both: ignored
      served(ist(2026, 11, 5, 16), 7, 10), // previous period but after 3:30 PM: ignored
    ]);
    expect(r.days[6]?.joins).toBe(12);
    expect(r.days[0]?.joins).toBe(3);
    expect(r.totals.joins).toBe(15);
    expect(r.previous.joins).toBe(50);
    const thu = r.peak.days.find((d) => d.weekday === "thu");
    expect(thu?.avgJoins[9]).toBe(12);
    expect(r.peak).toMatchObject({ max: 12, fromHour: 0, toHour: 10 });
  });

  it("averages need enough samples; rates are whole percents", () => {
    const few = full([served(ist(2026, 11, 12, 9), STATS_MIN_SAMPLES - 1, 10)]);
    expect(few.totals.avgWaitMs).toBeNull();
    expect(few.totals.etaAccuracyPct).toBeNull();
    // a day needs only 3 samples
    expect(few.days[6]?.avgWaitMs).toBe(600_000);

    const r = full([
      row(ist(2026, 11, 10, 11), {
        joins: 40,
        served: 30,
        noShows: 6,
        leaves: 3,
        cancels: 1,
        waits: 36,
        sumWaitMs: 36 * 12 * 60_000,
        intervals: 35,
        sumIntervalMs: 35 * 5 * 60_000,
        etaHits: 27,
        etaTotal: 36,
      }),
    ]);
    expect(r.totals).toEqual({
      joins: 40,
      served: 30,
      noShows: 6,
      left: 3,
      cancelled: 1,
      avgWaitMs: 12 * 60_000,
      avgServiceMs: 5 * 60_000,
      etaAccuracyPct: 75,
      noShowPct: Math.round((6 * 100) / 36),
      abandonmentPct: 10,
    });
  });

  it("peak cells are the average per occurrence of the weekday", () => {
    // 28 days from Fri 16 Oct: four Tuesdays (20, 27 Oct; 3, 10 Nov).
    const rows = [20, 27].map((d) => served(ist(2026, 10, d, 10), 8));
    const r = full(rows, 28);
    const tue = r.peak.days.find((d) => d.weekday === "tue");
    expect(tue?.avgJoins[10]).toBe(4);
  });

  it("statAverages is the MAP-05 math", () => {
    expect(
      statAverages({
        sumWaitMs: 25 * 600_000,
        waits: 25,
        sumIntervalMs: 22 * 240_000,
        intervals: 22,
        etaHits: 18,
        etaTotal: 25,
      }),
    ).toEqual({
      avgWaitMs: 600_000,
      avgServiceMs: 240_000,
      etaAccuracyPct: 72,
    });
  });
});

describe("plain-language insights (INS-06)", () => {
  /** Background traffic: 2 joins every hour 9–17 on every day of the 28-day range. */
  function background(from: number, days: number) {
    const rows: AnalyticsHourRow[] = [];
    for (let d = 0; d < days; d++) {
      for (let h = 9; h < 17; h++) {
        rows.push(row(from + d * DAY + h * HOUR, { joins: 2 }));
      }
    }
    return rows;
  }

  it("names the busiest weekday and hours when they stand out", () => {
    const from = insightsWindow(NOW, 28).from;
    const rows = background(from, 27).filter((r) => {
      const t = new Date(r.hourStart + 5.5 * HOUR);
      return !(t.getUTCDay() === 2 && [10, 11].includes(t.getUTCHours()));
    });
    for (const d of [20, 27]) {
      rows.push(row(ist(2026, 10, d, 10), { joins: 20 }));
      rows.push(row(ist(2026, 10, d, 11), { joins: 20 }));
    }
    for (const d of [3, 10]) {
      rows.push(row(ist(2026, 11, d, 10), { joins: 20 }));
      rows.push(row(ist(2026, 11, d, 11), { joins: 20 }));
    }
    const r = full(rows, 28);
    expect(r.insights[0]).toEqual({
      kind: "busiest",
      tone: "neutral",
      text: "Tuesdays 10 AM–12 PM are your busiest hours",
    });

    // One week: one Tuesday, so "was".
    const week = full(
      [
        ...background(insightsWindow(NOW, 7).from, 6),
        row(ist(2026, 11, 10, 10), { joins: 30 }),
        row(ist(2026, 11, 10, 11), { joins: 30 }),
      ],
      7,
    );
    expect(week.insights[0]?.text).toBe(
      "Tuesday 10 AM–12 PM was your busiest time",
    );
  });

  it("says nothing about busy hours with thin or flat data", () => {
    expect(full([row(ist(2026, 11, 10, 10), { joins: 29 })]).insights).toEqual(
      [],
    );
    const flat = full(background(insightsWindow(NOW, 28).from, 27), 28);
    expect(flat.insights.find((i) => i.kind === "busiest")).toBeUndefined();
  });

  it("waits shorter or longer than last week, only with enough samples", () => {
    const shorter = full([
      served(ist(2026, 11, 10, 11), 25, 9),
      served(ist(2026, 11, 3, 11), 25, 12),
    ]);
    expect(shorter.insights).toContainEqual({
      kind: "waits",
      tone: "good",
      text: "Your waits got 3 min shorter than last week",
    });
    const longer = full(
      [
        served(ist(2026, 11, 10, 11), 25, 20),
        served(ist(2026, 10, 1, 11), 25, 12),
      ],
      28,
    );
    expect(longer.insights).toContainEqual({
      kind: "waits",
      tone: "bad",
      text: "Your waits got 8 min longer than the 4 weeks before",
    });
    // 19 samples: nothing said
    expect(
      full([
        served(ist(2026, 11, 10, 11), 19, 9),
        served(ist(2026, 11, 3, 11), 25, 12),
      ]).insights,
    ).toEqual([]);
    // under a minute: nothing said
    expect(
      full([
        served(ist(2026, 11, 10, 11), 25, 10.4),
        served(ist(2026, 11, 3, 11), 25, 10),
      ]).insights,
    ).toEqual([]);
  });

  it("no-shows up or down vs last week (≥ 20 % and ≥ 2 points)", () => {
    const r = full([
      served(ist(2026, 11, 10, 11), 40, 10, 10), // 20 %
      served(ist(2026, 11, 3, 11), 45, 10, 5), // 10 %
    ]);
    expect(r.insights).toContainEqual({
      kind: "no_shows",
      tone: "bad",
      text: "No-shows are up 100% vs last week",
    });
    const small = full([
      served(ist(2026, 11, 10, 11), 40, 10, 5),
      served(ist(2026, 11, 3, 11), 42, 10, 5),
    ]);
    expect(small.insights.find((i) => i.kind === "no_shows")).toBeUndefined();
  });

  it("never more than three, in a fixed order", () => {
    const from = insightsWindow(NOW, 7).from;
    const rows = [
      served(from + 4 * DAY + 10 * HOUR, 60, 6, 15),
      served(from + 4 * DAY + 11 * HOUR, 60, 6, 15),
      served(from + 1 * DAY + 15 * HOUR, 2, 6),
      served(from + 2 * DAY + 9 * HOUR, 2, 6),
      served(from + 3 * DAY + 9 * HOUR, 2, 6),
      served(ist(2026, 11, 3, 11), 30, 12, 2),
    ];
    const r = full(rows);
    expect(r.insights.map((i) => i.kind)).toEqual([
      "busiest",
      "waits",
      "no_shows",
    ]);
    // deterministic
    expect(full(rows)).toEqual(r);
  });
});

describe("earnings helpers (INS-07)", () => {
  it("zero-fills days, sums them and groups them in weeks", () => {
    const from = ist(2026, 10, 16);
    const t = (captured: number, b: number) => ({
      ...emptyEarningsTotals(),
      capturedPaise: captured,
      businessSharePaise: b,
      platformSharePaise: captured - b,
      netPaise: captured,
      captures: 1,
    });
    const days = earningsDays(
      new Map([
        [from, t(2000, 1400)],
        [from + 8 * DAY, t(10000, 7000)],
        [from - DAY, t(99, 1)], // outside: ignored
      ]),
      from,
      28,
    );
    expect(days).toHaveLength(28);
    expect(days[0]?.date).toBe("2026-10-16");
    expect(days[1]?.capturedPaise).toBe(0);
    const total = sumEarnings(days);
    expect(total.capturedPaise).toBe(12000);
    expect(total.businessSharePaise + total.platformSharePaise).toBe(
      total.netPaise,
    );
    const weeks = earningsWeeks(days);
    expect(weeks.map((w) => w.totals.capturedPaise)).toEqual([
      2000, 10000, 0, 0,
    ]);
    expect(weeks[1]?.weekStart).toBe(from + 7 * DAY);
  });

  it("hour labels", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(9)).toBe("9 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(24)).toBe("12 AM");
    expect(hourRangeLabel(10, 12)).toBe("10 AM–12 PM");
  });
});
