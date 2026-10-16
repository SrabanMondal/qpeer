import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM", 24-hour clock, 00:00 to 23:59. Local time in Asia/Kolkata (v1). */
export const TimeOfDay = z
  .string()
  .regex(TIME_RE, "Expected time as HH:MM (24h)");

export const HoursRange = z
  .object({
    from: TimeOfDay,
    to: TimeOfDay,
  })
  .strict()
  // Only compare when both are well-formed, so a bad format yields one issue.
  // "HH:MM" strings order the same way as the times they represent.
  .refine(
    (r) => !TIME_RE.test(r.from) || !TIME_RE.test(r.to) || r.from < r.to,
    {
      message: "'from' must be earlier than 'to'",
      path: ["to"],
    },
  );

export type HoursRange = z.infer<typeof HoursRange>;

/** 0–3 ranges for one day, sorted by start, not overlapping. Empty = closed. */
export const DayHours = z
  .array(HoursRange)
  .max(3, "At most 3 ranges per day")
  .superRefine((ranges, ctx) => {
    for (let i = 1; i < ranges.length; i++) {
      const prev = ranges[i - 1];
      const cur = ranges[i];
      if (![prev.from, prev.to, cur.from].every((t) => TIME_RE.test(t))) {
        continue; // format errors are already reported on the range itself
      }
      if (cur.from < prev.from) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ranges must be sorted by start time",
          path: [i, "from"],
        });
      } else if (cur.from < prev.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ranges must not overlap",
          path: [i, "from"],
        });
      }
    }
  });

export type DayHours = z.infer<typeof DayHours>;

export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];
export const WeekdaySchema = z.enum(WEEKDAYS);

export const WeeklyHours = z
  .object({
    mon: DayHours,
    tue: DayHours,
    wed: DayHours,
    thu: DayHours,
    fri: DayHours,
    sat: DayHours,
    sun: DayHours,
  })
  .strict();

export type WeeklyHours = z.infer<typeof WeeklyHours>;

// ---------- open now (fixed zone Asia/Kolkata, UTC+05:30, no DST) ----------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Weekday by JS `getUTCDay()` index (0 = Sunday). */
const BY_JS_DAY: readonly Weekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

/** IST weekday and "HH:MM" local time of an instant (epoch ms). */
export function istLocalTime(t: number): { day: Weekday; time: string } {
  const local = t + IST_OFFSET_MS;
  const d = new Date(local);
  const minutes = Math.floor((((local % DAY_MS) + DAY_MS) % DAY_MS) / 60_000);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return { day: BY_JS_DAY[d.getUTCDay()], time: `${hh}:${mm}` };
}

/**
 * True when `t` falls inside one of the day's ranges in IST. A range includes
 * its start minute and excludes its end minute (`09:00–13:00` is open at 12:59,
 * closed at 13:00). Ranges never cross midnight (`from < to`), so 00:00 always
 * belongs to the new day's ranges.
 */
export function isOpenAt(hours: WeeklyHours, t: number): boolean {
  const { day, time } = istLocalTime(t);
  // "HH:MM" strings order the same way as the times they represent.
  return hours[day].some((r) => r.from <= time && time < r.to);
}

/** "17:30" → "5:30 PM". Bad input is returned as is. */
export function formatTime12(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** Today's (IST) ranges plus display text: "9:00 AM – 1:00 PM, 5:00 PM – 9:00 PM" or "Closed today". */
export function todayHours(
  hours: WeeklyHours,
  t: number,
): { day: Weekday; ranges: DayHours; text: string } {
  const { day } = istLocalTime(t);
  const ranges = hours[day];
  const text =
    ranges.length === 0
      ? "Closed today"
      : ranges
          .map((r) => `${formatTime12(r.from)} – ${formatTime12(r.to)}`)
          .join(", ");
  return { day, ranges, text };
}

/** Mon–Sat 09:00–18:00, Sunday closed. Returns a fresh object each call. */
export function defaultWeeklyHours(): WeeklyHours {
  const day = () => [{ from: "09:00", to: "18:00" }];
  return {
    mon: day(),
    tue: day(),
    wed: day(),
    thu: day(),
    fri: day(),
    sat: day(),
    sun: [],
  };
}
