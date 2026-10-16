import { describe, expect, it } from "vitest";
import { newerTokenView, type TokenView } from "./queue";

const view = (over: Partial<TokenView>): TokenView => ({
  id: "t1",
  queueId: "q1",
  businessId: "b1",
  businessName: "Clinic",
  queueName: "OPD",
  number: 4,
  series: "R",
  label: "4",
  method: "walkin",
  state: "WAITING",
  queueStatus: "open",
  peopleAhead: 2,
  nowServing: null,
  etaLowMs: null,
  etaHighMs: null,
  beBackByMs: null,
  leaveHomeByMs: null,
  counter: null,
  joinedAt: 0,
  calledAt: null,
  graceUntil: null,
  endedAt: null,
  endReason: null,
  paid: false,
  rev: 1,
  ...over,
});

describe("newerTokenView (Step 3.5 H1)", () => {
  it("keeps a LEFT view when an older WAITING view arrives late", () => {
    const left = view({ state: "LEFT", endReason: "left", rev: 2 });
    const stale = view({ state: "WAITING", rev: 1 });
    expect(newerTokenView(left, stale)).toBe(left);
  });

  it("takes the incoming view on an equal or higher rev", () => {
    const cur = view({ peopleAhead: 3, rev: 1 });
    const fresher = view({ peopleAhead: 2, rev: 1 });
    expect(newerTokenView(cur, fresher)).toBe(fresher);
    const called = view({ state: "CALLED", rev: 2 });
    expect(newerTokenView(cur, called)).toBe(called);
    expect(newerTokenView(undefined, cur)).toBe(cur);
  });
});
