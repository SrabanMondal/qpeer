import { describe, expect, it } from "vitest";
import {
  type DemoQueueProfile,
  generateDemoHistory,
  makeDemoRng,
} from "./demo-data";
import { istLocalTime, type WeeklyHours } from "./hours";
import { buildAnalytics } from "./insights";

const HOUR = 3_600_000;

function ist(y: number, mo: number, d: number, h = 0, mi = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi) - 5.5 * HOUR;
}

const NOW = ist(2026, 11, 12, 15, 30);

const clinicHours: WeeklyHours = {
  mon: [
    { from: "09:00", to: "13:00" },
    { from: "17:00", to: "20:30" },
  ],
  tue: [
    { from: "09:00", to: "13:00" },
    { from: "17:00", to: "20:30" },
  ],
  wed: [{ from: "09:00", to: "18:00" }],
  thu: [{ from: "09:00", to: "18:00" }],
  fri: [{ from: "09:00", to: "18:00" }],
  sat: [{ from: "09:00", to: "14:00" }],
  sun: [],
};

const clinic: DemoQueueProfile = {
  queueId: "q-clinic",
  businessId: "b-clinic",
  category: "clinic",
  hours: clinicHours,
  baseJoinsPerHour: 6,
  serviceMin: 5,
  reservationFeePaise: 2000,
  priorityFeePaise: 10000,
  priorityCancelRefundPct: 50,
};

const opts = {
  now: NOW,
  weeks: 6,
  seed: "test",
  businessSharePct: 70,
  paymentIdPrefix: "pay-",
  customerUserId: "demo-customer",
};

describe("demo history generator (DEM-02, DEM-03)", () => {
  const h = generateDemoHistory([clinic], opts);

  it("is deterministic for the same seed and different for another", () => {
    expect(generateDemoHistory([clinic], opts)).toEqual(h);
    expect(
      generateDemoHistory([clinic], { ...opts, seed: "other" }).analytics,
    ).not.toEqual(h.analytics);
    const a = makeDemoRng("x");
    const b = makeDemoRng("x");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("only finished hours inside the opening hours, 6 weeks back", () => {
    const currentHour = ist(2026, 11, 12, 15);
    expect(h.analytics.length).toBeGreaterThan(200);
    for (const r of h.analytics) {
      expect(r.hourStart + HOUR).toBeLessThanOrEqual(currentHour);
      // IST hour starts (UTC+05:30)
      expect((r.hourStart + 5.5 * HOUR) % HOUR).toBe(0);
      const { day, time } = istLocalTime(r.hourStart);
      expect(day).not.toBe("sun");
      const hour = Number(time.slice(0, 2));
      expect(
        clinicHours[day].some(
          (x) => Number(x.from.slice(0, 2)) <= hour && x.to > time,
        ),
      ).toBe(true);
      expect(r.served + r.noShows + r.leaves + r.cancels).toBe(r.joins);
      expect(r.etaHits).toBeLessThanOrEqual(r.etaTotal);
    }
    const first = Math.min(...h.analytics.map((r) => r.hourStart));
    expect(NOW - first).toBeGreaterThan(41 * 24 * HOUR);
    expect(NOW - first).toBeLessThan(43 * 24 * HOUR);
  });

  it("trends up slowly and peaks on weekday mornings with a lunch dip", () => {
    const joinsBy = (pred: (hour: number, day: string) => boolean) =>
      h.analytics
        .filter((r) => {
          const { day, time } = istLocalTime(r.hourStart);
          return pred(Number(time.slice(0, 2)), day);
        })
        .reduce((s, r) => s + r.joins, 0);
    const morning = joinsBy((hr, d) => d === "wed" && hr >= 10 && hr < 12) / 2;
    const lunch = joinsBy((hr, d) => d === "wed" && hr >= 13 && hr < 15) / 2;
    expect(morning).toBeGreaterThan(lunch * 2);
    const weekMs = 7 * 24 * HOUR;
    const inWeek = (k: number) =>
      h.analytics
        .filter(
          (r) =>
            r.hourStart >= NOW - k * weekMs &&
            r.hourStart < NOW - (k - 1) * weekMs,
        )
        .reduce((s, r) => s + r.joins, 0);
    expect(inWeek(2)).toBeGreaterThan(inWeek(6));
  });

  it("payments and ledger follow the money rules (70/30, refunds, forfeits)", () => {
    expect(h.payments.length).toBeGreaterThan(10);
    const kinds = new Set(h.payments.map((p) => p.status));
    expect(kinds).toEqual(new Set(["allocated", "refunded", "forfeited"]));
    for (const p of h.payments) {
      const rows = h.ledger.filter((l) => l.paymentId === p.id);
      const sum = (k: string) =>
        rows.filter((l) => l.kind === k).reduce((s, l) => s + l.amountPaise, 0);
      const net = sum("capture") + sum("refund");
      expect(sum("business_share") + sum("platform_share")).toBe(net);
      expect(sum("capture")).toBe(p.amountPaise);
      expect(rows.every((l) => l.at <= NOW && l.at >= p.createdAt)).toBe(true);
      if (p.status === "refunded") {
        expect(-sum("refund")).toBe(p.refundPaise);
        if (p.kind === "priority") expect(p.refundPaise).toBe(5000);
      }
      if (p.status === "forfeited") {
        expect(
          rows.some((l) => l.kind === "forfeit" && l.amountPaise === 0),
        ).toBe(true);
        expect(sum("business_share")).toBe(Math.floor(p.amountPaise * 0.7));
      }
    }
    expect(new Set(h.ledger.map((l) => l.id)).size).toBe(h.ledger.length);
  });

  it("gives the owner something to read on the Insights tab", () => {
    const r = buildAnalytics(h.analytics, { now: NOW, rangeDays: 28 });
    expect(r.totals.avgWaitMs).not.toBeNull();
    expect(r.totals.etaAccuracyPct).toBeGreaterThanOrEqual(70);
    expect(r.totals.etaAccuracyPct).toBeLessThanOrEqual(90);
    expect(r.insights.length).toBeGreaterThan(0);
    expect(r.insights[0]?.kind).toBe("busiest");
  });
});
