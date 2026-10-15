/**
 * Single-alarm scheduler (architecture doc §9.7). A Durable Object has one
 * alarm, so the DO collects the due times of everything it must do later and
 * sets the alarm to the earliest. `alarm()` handles everything due, then
 * reschedules.
 */

export const SNAPSHOT_MIN_INTERVAL_MS = 30_000;
export const FAR_FANOUT_INTERVAL_MS = 30_000;
/** Outbox retry backoff: 5 s, 30 s, 2 min, 10 min, then every 30 min. */
export const OUTBOX_BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000];

export function outboxBackoff(attempts: number): number {
  return OUTBOX_BACKOFF_MS[
    Math.min(Math.max(attempts, 1), OUTBOX_BACKOFF_MS.length) - 1
  ];
}

export interface DueTimes {
  graceExpiry: number | null;
  snapshotFlush: number | null;
  outboxRetry: number | null;
  headBackAlert: number | null;
  hourlyFlush: number | null;
  farFanout: number | null;
}

/** Earliest of the due times, or null when nothing is pending. */
export function earliestDue(due: DueTimes): number | null {
  let min: number | null = null;
  for (const t of Object.values(due)) {
    if (t !== null && (min === null || t < min)) min = t;
  }
  return min;
}

// ---------- IST hours (fixed zone Asia/Kolkata, UTC+05:30, no DST) ----------

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 5.5 * HOUR_MS;

/** Start of the IST hour containing `t` (epoch ms). */
export function istHourStart(t: number): number {
  return Math.floor((t + IST_OFFSET_MS) / HOUR_MS) * HOUR_MS - IST_OFFSET_MS;
}

/** IST calendar day number of `t` (for daily caps). */
export function istDay(t: number): number {
  return Math.floor((t + IST_OFFSET_MS) / DAY_MS);
}

export { HOUR_MS };
