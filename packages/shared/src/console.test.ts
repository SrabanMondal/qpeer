import { describe, expect, it } from "vitest";
import { closeSummary, lastCalledLabel } from "./console";
import type { ConsoleToken } from "./queue";

function tok(over: Partial<ConsoleToken> & { id: string }): ConsoleToken {
  return {
    number: 1,
    series: "R",
    label: "1",
    cls: "regular",
    method: "walkin",
    state: "WAITING",
    position: null,
    joinedAt: 0,
    calledAt: null,
    counter: null,
    graceUntil: null,
    paid: false,
    ...over,
  };
}

describe("lastCalledLabel (Undo bar)", () => {
  it("a called Priority Pass → P1", () => {
    const p1 = tok({
      id: "p1",
      series: "P",
      label: "P1",
      state: "CALLED",
      calledAt: 100,
    });
    expect(lastCalledLabel({ serving: [p1], grace: [], missed: [] })).toBe(
      "P1",
    );
  });

  it("after a No-show the token is in grace → still its label, not ?", () => {
    const p1 = tok({
      id: "p1",
      series: "P",
      label: "P1",
      state: "GRACE",
      calledAt: 100,
    });
    expect(lastCalledLabel({ serving: [], grace: [p1] })).toBe("P1");
  });

  it("several called → the most recent one (triage T2)", () => {
    const r = tok({ id: "r", label: "4", state: "CALLED", calledAt: 100 });
    const t = tok({
      id: "t",
      series: "T",
      label: "T2",
      cls: "triage",
      state: "CALLED",
      calledAt: 200,
    });
    expect(lastCalledLabel({ serving: [r, t], grace: [], missed: [] })).toBe(
      "T2",
    );
  });

  it("nothing called → null", () => {
    expect(lastCalledLabel({ serving: [], grace: [], missed: [] })).toBeNull();
  });
});

describe("closeSummary (Close for the day)", () => {
  const now = 1_000;
  const counts = (total: number, booked = 0) => ({
    waiting: 0,
    inService: 0,
    grace: 0,
    total,
    booked,
  });

  it("counts the paid tickets that end: reservation waiting, pass at a counter, late upgrade", () => {
    const s = closeSummary(
      {
        waiting: [
          tok({ id: "res", paid: true, method: "remote" }),
          tok({ id: "free" }),
        ],
        serving: [
          tok({ id: "p1", series: "P", label: "P1", paid: true, calledAt: 5 }),
        ],
        grace: [tok({ id: "up", paid: true, calledAt: 4 })],
        counts: counts(4, 2),
      },
      now,
    );
    expect(s).toEqual({ ending: 4, kept: 0, paidRefunded: 3, booked: 2 });
  });

  it("paid waiting tickets valid beyond today carry over → not refunded", () => {
    const s = closeSummary(
      {
        waiting: [
          tok({ id: "kept", paid: true, expiresAt: now + 1 }),
          tok({ id: "ends", paid: true, expiresAt: now - 1 }),
        ],
        serving: [],
        grace: [],
        counts: counts(2),
      },
      now,
    );
    expect(s).toEqual({ ending: 1, kept: 1, paidRefunded: 1, booked: 0 });
  });
});
