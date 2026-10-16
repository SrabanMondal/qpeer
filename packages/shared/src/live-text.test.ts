import { describe, expect, it } from "vitest";
import {
  approxDuration,
  openLook,
  waitRangeAt,
  waitSummary,
  waitText,
} from "./live-text";

const MIN = 60_000;
const NOW = 1_800_000_000_000;

describe("openLook (B16: queue state decides, hours inform)", () => {
  it("open inside hours", () => {
    expect(openLook("open", true)).toMatchObject({
      kind: "open",
      label: "Open now",
    });
  });
  it("open outside hours says so", () => {
    expect(openLook("open", false)).toMatchObject({
      kind: "open_after_hours",
      label: "Open (after usual hours)",
      tone: "success",
    });
  });
  it("open with unknown hours is plain open", () => {
    expect(openLook("open", undefined).label).toBe("Open now");
  });
  it("paused", () => {
    expect(openLook("paused", true).label).toBe("Paused");
  });
  it("closed inside hours = the queue isn't open; outside = closed", () => {
    expect(openLook("closed", true).label).toBe("Queue not open");
    expect(openLook("closed", false).label).toBe("Closed now");
  });
});

describe("waitText / waitSummary (B19)", () => {
  const base = { waitLowMs: 2 * MIN, waitHighMs: 8 * MIN, updatedAt: NOW };

  it("nobody waiting, nobody at a counter → No wait", () => {
    const s = { ...base, waiting: 0, inService: 0 };
    expect(waitText(s, NOW)).toBe("No wait");
    expect(waitSummary(s, NOW)).toBe("No wait");
    expect(waitSummary(s, NOW, true)).toBe("No wait");
  });

  it("unknown inService (older server) counts as nobody", () => {
    expect(waitText({ ...base, waiting: 0 }, NOW)).toBe("No wait");
  });

  it("nobody waiting, someone at the counter → Next in ~N min", () => {
    const s = { ...base, waiting: 0, inService: 1 };
    expect(waitText(s, NOW)).toBe("Next in ~5 min");
    expect(waitSummary(s, NOW, true)).toBe("Next in ~5 min");
  });

  it("people waiting → count and wait; compact for pills", () => {
    const s = { ...base, waiting: 3, inService: 1 };
    expect(waitSummary(s, NOW)).toBe("3 waiting · ~5 min");
    expect(waitSummary(s, NOW, true)).toBe("3 · ~5 min");
  });

  it("unknown wait shows only the count", () => {
    const s = { waiting: 3, waitLowMs: null, waitHighMs: null };
    expect(waitText(s, NOW)).toBeNull();
    expect(waitSummary(s, NOW)).toBe("3 waiting");
  });

  it("a snapshot's age is subtracted, so it agrees with a live summary", () => {
    const snapshot = { ...base, waiting: 2, updatedAt: NOW - 2 * MIN };
    const live = {
      waiting: 2,
      waitLowMs: 0,
      waitHighMs: 6 * MIN,
      updatedAt: NOW,
    };
    expect(waitRangeAt(snapshot, NOW)).toEqual({ lowMs: 0, highMs: 6 * MIN });
    expect(waitText(snapshot, NOW)).toBe(waitText(live, NOW));
  });

  it("approxDuration formats the midpoint", () => {
    expect(approxDuration(0, 20_000)).toBe("< 1 min");
    expect(approxDuration(60 * MIN, 80 * MIN)).toBe("~1 h 10 min");
    expect(approxDuration(120 * MIN, 120 * MIN)).toBe("~2 h");
  });
});
