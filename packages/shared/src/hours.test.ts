import { describe, expect, it } from "vitest";
import { DayHours, defaultWeeklyHours, HoursRange, WeeklyHours } from "./hours";

function issuePaths(result: { success: boolean; error?: unknown }): string[] {
  if (result.success) return [];
  const err = result.error as { issues: { path: (string | number)[] }[] };
  return err.issues.map((i) => i.path.join("."));
}

describe("HoursRange", () => {
  it("accepts a valid range", () => {
    expect(HoursRange.safeParse({ from: "09:00", to: "13:30" }).success).toBe(
      true,
    );
  });

  it.each([
    ["9:00", "13:00"],
    ["09:00", "24:00"],
    ["09:60", "10:00"],
    ["0900", "1000"],
    ["", "10:00"],
  ])("BIZ-06: rejects bad format %s-%s", (from, to) => {
    expect(HoursRange.safeParse({ from, to }).success).toBe(false);
  });

  it("BIZ-06: rejects from >= to", () => {
    const equal = HoursRange.safeParse({ from: "10:00", to: "10:00" });
    const backwards = HoursRange.safeParse({ from: "18:00", to: "09:00" });
    expect(equal.success).toBe(false);
    expect(backwards.success).toBe(false);
    expect(issuePaths(backwards)).toEqual(["to"]);
  });

  it("rejects unknown keys", () => {
    expect(
      HoursRange.safeParse({ from: "09:00", to: "10:00", extra: 1 }).success,
    ).toBe(false);
  });
});

describe("DayHours", () => {
  it("accepts closed (empty) and up to 3 sorted, non-overlapping ranges", () => {
    expect(DayHours.safeParse([]).success).toBe(true);
    expect(
      DayHours.safeParse([
        { from: "08:00", to: "10:00" },
        { from: "10:00", to: "13:00" },
        { from: "17:00", to: "21:00" },
      ]).success,
    ).toBe(true);
  });

  it("BIZ-06: rejects more than 3 ranges", () => {
    const r = DayHours.safeParse([
      { from: "08:00", to: "09:00" },
      { from: "10:00", to: "11:00" },
      { from: "12:00", to: "13:00" },
      { from: "14:00", to: "15:00" },
    ]);
    expect(r.success).toBe(false);
  });

  it("BIZ-06: rejects overlapping ranges", () => {
    const r = DayHours.safeParse([
      { from: "09:00", to: "13:00" },
      { from: "12:00", to: "15:00" },
    ]);
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toEqual(["1.from"]);
  });

  it("BIZ-06: rejects unsorted ranges", () => {
    const r = DayHours.safeParse([
      { from: "14:00", to: "18:00" },
      { from: "09:00", to: "13:00" },
    ]);
    expect(r.success).toBe(false);
    expect(issuePaths(r)).toEqual(["1.from"]);
  });
});

describe("WeeklyHours", () => {
  it("defaultWeeklyHours is Mon-Sat 09:00-18:00, Sunday closed, and valid", () => {
    const d = defaultWeeklyHours();
    expect(WeeklyHours.parse(d)).toEqual(d);
    expect(d.mon).toEqual([{ from: "09:00", to: "18:00" }]);
    expect(d.sat).toEqual([{ from: "09:00", to: "18:00" }]);
    expect(d.sun).toEqual([]);
  });

  it("returns a fresh object each call", () => {
    const a = defaultWeeklyHours();
    a.mon.push({ from: "19:00", to: "20:00" });
    expect(defaultWeeklyHours().mon).toHaveLength(1);
  });

  it("requires every weekday and reports the nested path", () => {
    const { sun: _sun, ...noSunday } = defaultWeeklyHours();
    expect(WeeklyHours.safeParse(noSunday).success).toBe(false);

    const bad = { ...defaultWeeklyHours(), tue: [{ from: "x", to: "10:00" }] };
    expect(issuePaths(WeeklyHours.safeParse(bad))).toEqual(["tue.0.from"]);
  });
});
