import { describe, expect, it } from "vitest";
import {
  autoCloseAt,
  DayHours,
  defaultWeeklyHours,
  HoursRange,
  isOpenAt,
  istDayStart,
  istLocalTime,
  todayHours,
  WeeklyHours,
} from "./hours";

/** Epoch ms of an IST wall-clock time (UTC+05:30). Month is 1-based. */
function ist(y: number, mo: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, mo - 1, d, h, mi) - 5.5 * 3_600_000;
}

// 2026-10-12 is a Monday, 2026-10-18 a Sunday.
describe("isOpenAt (MAP-04 open now, Asia/Kolkata)", () => {
  const hours: WeeklyHours = {
    ...defaultWeeklyHours(),
    mon: [
      { from: "09:00", to: "13:00" },
      { from: "17:00", to: "21:00" },
    ],
    sat: [{ from: "00:00", to: "23:59" }],
    sun: [],
  };

  it("istLocalTime converts UTC to IST day and time", () => {
    // 18:30 UTC Sunday = 00:00 IST Monday
    expect(istLocalTime(Date.UTC(2026, 9, 11, 18, 30))).toEqual({
      day: "mon",
      time: "00:00",
    });
    expect(istLocalTime(ist(2026, 10, 12, 9, 5))).toEqual({
      day: "mon",
      time: "09:05",
    });
  });

  it("multiple ranges: open inside each, closed in the gap", () => {
    expect(isOpenAt(hours, ist(2026, 10, 12, 10, 0))).toBe(true);
    expect(isOpenAt(hours, ist(2026, 10, 12, 15, 0))).toBe(false);
    expect(isOpenAt(hours, ist(2026, 10, 12, 18, 30))).toBe(true);
    expect(isOpenAt(hours, ist(2026, 10, 12, 22, 0))).toBe(false);
  });

  it("edges: start minute is open, end minute is closed", () => {
    expect(isOpenAt(hours, ist(2026, 10, 12, 8, 59))).toBe(false);
    expect(isOpenAt(hours, ist(2026, 10, 12, 9, 0))).toBe(true);
    expect(isOpenAt(hours, ist(2026, 10, 12, 12, 59))).toBe(true);
    expect(isOpenAt(hours, ist(2026, 10, 12, 13, 0))).toBe(false);
  });

  it("closed day is never open", () => {
    expect(isOpenAt(hours, ist(2026, 10, 18, 10, 0))).toBe(false);
  });

  it("midnight boundary: Saturday's all-day range ends, Sunday (closed) begins", () => {
    expect(isOpenAt(hours, ist(2026, 10, 17, 23, 58))).toBe(true);
    expect(isOpenAt(hours, ist(2026, 10, 17, 23, 59))).toBe(false);
    expect(isOpenAt(hours, ist(2026, 10, 18, 0, 0))).toBe(false);
    // Saturday 00:00 IST is Friday 18:30 UTC: the UTC day must not be used.
    expect(isOpenAt(hours, Date.UTC(2026, 9, 16, 18, 30))).toBe(true);
    expect(isOpenAt(hours, Date.UTC(2026, 9, 16, 18, 29))).toBe(false); // Fri 23:59 IST
  });

  it("todayHours gives the IST day's ranges and 12-hour text", () => {
    expect(todayHours(hours, ist(2026, 10, 12, 1, 0))).toEqual({
      day: "mon",
      ranges: hours.mon,
      text: "9:00 AM – 1:00 PM, 5:00 PM – 9:00 PM",
    });
    expect(todayHours(hours, ist(2026, 10, 18, 12, 0)).text).toBe(
      "Closed today",
    );
  });
});

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

describe("autoCloseAt (B20, INC-047)", () => {
  const hours: WeeklyHours = {
    ...defaultWeeklyHours(),
    mon: [
      { from: "09:00", to: "13:00" },
      { from: "17:00", to: "21:00" },
    ],
    sun: [],
  };

  it("30 min after the day's last range, even when opened in the first", () => {
    expect(autoCloseAt(hours, ist(2026, 10, 12, 9, 5))).toBe(
      ist(2026, 10, 12, 21, 30),
    );
  });

  it("opened between ranges still closes after the last one", () => {
    expect(autoCloseAt(hours, ist(2026, 10, 12, 14, 0))).toBe(
      ist(2026, 10, 12, 21, 30),
    );
  });

  it("opened after the last range: 23:59 IST of that day", () => {
    expect(autoCloseAt(hours, ist(2026, 10, 12, 22, 0))).toBe(
      ist(2026, 10, 12, 23, 59),
    );
  });

  it("opened on a closed day: 23:59 IST", () => {
    expect(autoCloseAt(hours, ist(2026, 10, 18, 10, 0))).toBe(
      ist(2026, 10, 18, 23, 59),
    );
  });

  it("never sooner than 30 min after opening", () => {
    expect(autoCloseAt(hours, ist(2026, 10, 12, 21, 20))).toBe(
      ist(2026, 10, 12, 21, 50),
    );
    expect(autoCloseAt(hours, ist(2026, 10, 12, 23, 50))).toBe(
      ist(2026, 10, 13, 0, 20),
    );
  });

  it("istDayStart is IST midnight", () => {
    expect(istDayStart(ist(2026, 10, 12, 0, 0))).toBe(ist(2026, 10, 12, 0, 0));
    expect(istDayStart(ist(2026, 10, 12, 23, 59))).toBe(
      ist(2026, 10, 12, 0, 0),
    );
  });
});
