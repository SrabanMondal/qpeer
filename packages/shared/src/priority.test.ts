import { describe, expect, it } from "vitest";
import { refundAmount, refundSplit, splitPaise } from "./payments";
import {
  CHECK_CODE_ALPHABET,
  callOrder,
  creditsAfterCall,
  type LaneState,
  lateWindowEndsAt,
  makeCheckCode,
  newPriorityPeopleAhead,
  newRegularPeopleAhead,
  nextLane,
  normalizeCheckCode,
  priorityPeopleAhead,
  regularPeopleAhead,
  rejoinBehind,
  savingMinutes,
  showSaving,
  withinLateWindow,
} from "./priority";

const MIN = 60_000;

describe("PRI-06 credit counter (C1)", () => {
  it("+1 per regular call capped at N, −N per priority call, triage changes nothing", () => {
    expect(creditsAfterCall(0, "regular", 2)).toBe(1);
    expect(creditsAfterCall(2, "regular", 2)).toBe(2);
    expect(creditsAfterCall(2, "priority", 2)).toBe(0);
    expect(creditsAfterCall(1, "priority", 2)).toBe(0);
    expect(creditsAfterCall(1, "triage", 2)).toBe(1);
  });

  it("Next: triage first; priority only when due; regulars otherwise; priority when no regulars", () => {
    const all = { triage: true, priority: true, regular: true };
    expect(nextLane(all, 2, 2)).toBe("triage");
    const pr = { triage: false, priority: true, regular: true };
    expect(nextLane(pr, 0, 2)).toBe("regular");
    expect(nextLane(pr, 1, 2)).toBe("regular");
    expect(nextLane(pr, 2, 2)).toBe("priority");
    expect(nextLane({ ...pr, regular: false }, 0, 2)).toBe("priority");
    expect(
      nextLane({ triage: false, priority: false, regular: false }, 0, 2),
    ).toBeNull();
  });

  it("C1: from a fresh session (credits 0) with 1-in-2 the calls go R R P R R P", () => {
    const order = callOrder(
      {
        triage: [],
        priority: ["P1", "P2", "P3"],
        regular: ["1", "2", "3", "4", "5"],
      },
      0,
      2,
    );
    expect(order).toEqual(["1", "2", "P1", "3", "4", "P2", "5", "P3"]);
  });

  it("1-in-1 alternates once due; no burst after a quiet period (cap N)", () => {
    expect(
      callOrder(
        { triage: ["T1"], priority: ["P1", "P2"], regular: ["1", "2"] },
        1,
        1,
      ),
    ).toEqual(["T1", "P1", "1", "P2", "2"]);
    // Credits never exceed N, so only one priority call is due at once.
    expect(
      callOrder(
        { triage: [], priority: ["P1", "P2", "P3"], regular: ["1", "2"] },
        3,
        3,
      ),
    ).toEqual(["P1", "1", "2", "P2", "P3"]);
  });
});

describe("PRI-08 people ahead (C3) matches the call order", () => {
  it("random lanes: priority = exact index; regular low = index; high ≥ low", () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 300; round++) {
      const t = rnd(3);
      const p = rnd(6);
      const r = rnd(12);
      const n = 1 + rnd(4);
      const c = rnd(n + 1);
      const lanes = {
        triage: Array.from({ length: t }, (_, i) => `T${i}`),
        priority: Array.from({ length: p }, (_, i) => `P${i}`),
        regular: Array.from({ length: r }, (_, i) => `R${i}`),
      };
      const order = callOrder(lanes, c, n);
      const s: LaneState = {
        triageWaiting: t,
        priorityWaiting: p,
        regularWaiting: r,
        credits: c,
        perRegular: n,
        priorityEnabled: true,
      };
      lanes.priority.forEach((id, q) => {
        expect(priorityPeopleAhead(s, q)).toBe(order.indexOf(id));
      });
      lanes.regular.forEach((id, k) => {
        const range = regularPeopleAhead(s, k);
        expect(range.low).toBe(order.indexOf(id));
        expect(range.high).toBeGreaterThanOrEqual(range.low);
      });
    }
  });

  it("C3 example: 4 regulars ahead, 1-in-2, nobody checked in → 4–6", () => {
    const s: LaneState = {
      triageWaiting: 0,
      priorityWaiting: 0,
      regularWaiting: 10,
      credits: 0,
      perRegular: 2,
      priorityEnabled: true,
    };
    expect(regularPeopleAhead(s, 4)).toEqual({ low: 4, high: 6 });
    expect(regularPeopleAhead({ ...s, priorityWaiting: 1 }, 4)).toEqual({
      low: 5,
      high: 6,
    });
    // Lane off: no range.
    expect(regularPeopleAhead({ ...s, priorityEnabled: false }, 4)).toEqual({
      low: 4,
      high: 4,
    });
  });

  it("new joiners: a pass holder checking in now vs a regular joining now", () => {
    const s: LaneState = {
      triageWaiting: 1,
      priorityWaiting: 1,
      regularWaiting: 8,
      credits: 1,
      perRegular: 2,
      priorityEnabled: true,
    };
    // 1 triage + 1 priority ahead + regulars before due: (2−1) + 1·2 = 3.
    expect(newPriorityPeopleAhead(s)).toBe(5);
    const reg = newRegularPeopleAhead(s);
    expect(reg.low).toBe(1 + 8 + 1 + 0); // P0 due after 1 regular, then 8 regs before me (P not waiting beyond)
    expect(reg.high).toBe(1 + Math.ceil((8 * 3) / 2));
  });
});

describe("R1 / QUE-27 rejoin position", () => {
  it("K = max(1, ceil(rejoinDelayMin ÷ avgServiceMin)): clinic 3 min → 5, salon 30 min → 1", () => {
    expect(rejoinBehind(15, 3 * MIN)).toBe(5);
    expect(rejoinBehind(15, 30 * MIN)).toBe(1);
    expect(rejoinBehind(15, 5 * MIN)).toBe(3);
    expect(rejoinBehind(0, 5 * MIN)).toBe(1);
    expect(rejoinBehind(15, 0)).toBe(900); // under 1 s counts as 1 s
  });

  it("late window: within → K rule, after → end; null = no limit", () => {
    const missed = 1_000_000;
    expect(withinLateWindow(missed, 15, missed + 15 * MIN)).toBe(true);
    expect(withinLateWindow(missed, 15, missed + 15 * MIN + 1)).toBe(false);
    expect(withinLateWindow(missed, null, missed + 1e9)).toBe(true);
    expect(lateWindowEndsAt(missed, 15)).toBe(missed + 15 * MIN);
    expect(lateWindowEndsAt(missed, null)).toBeNull();
  });
});

describe("C2 upgrade saving", () => {
  it("whole minutes between midpoints, never negative; hidden below the threshold and at 0", () => {
    const s = savingMinutes(
      { lowMs: 20 * MIN, highMs: 30 * MIN },
      { lowMs: 5 * MIN, highMs: 9 * MIN },
    );
    expect(s).toBe(18);
    expect(
      savingMinutes(
        { lowMs: 0, highMs: 1 },
        { lowMs: 5 * MIN, highMs: 6 * MIN },
      ),
    ).toBe(0);
    expect(showSaving(18, 5)).toBe(true);
    expect(showSaving(4, 5)).toBe(false);
    expect(showSaving(0, 0)).toBe(false);
    expect(showSaving(1, 0)).toBe(true);
  });
});

describe("R2 check code", () => {
  it("QUE-29: 4 characters, no look-alikes (0/O, 1/I/L)", () => {
    for (const bad of ["0", "O", "1", "I", "L"]) {
      expect(CHECK_CODE_ALPHABET.includes(bad)).toBe(false);
    }
    for (let i = 0; i < 200; i++) {
      const c = makeCheckCode();
      expect(c).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    }
    expect(normalizeCheckCode(" k7p2 ")).toBe("K7P2");
    expect(normalizeCheckCode("K0P2")).toBeNull();
    expect(normalizeCheckCode("K7P")).toBeNull();
  });
});

describe("PAY-10 split", () => {
  it("70/30 adds up exactly; refunds reverse in proportion", () => {
    expect(splitPaise(2000, 70)).toEqual({ business: 1400, platform: 600 });
    expect(splitPaise(999, 70)).toEqual({ business: 699, platform: 300 });
    expect(refundSplit(10000, 5000, 70)).toEqual({
      business: 3500,
      platform: 1500,
    });
    expect(refundSplit(999, 999, 70)).toEqual({ business: 699, platform: 300 });
    expect(refundAmount(10000, 50)).toBe(5000);
    expect(refundAmount(999, 50)).toBe(499);
  });
});
