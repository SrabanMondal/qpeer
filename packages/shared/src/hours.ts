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
