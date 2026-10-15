/** Single clock source. Tests inject their own through `createApp({ clock })`. */
export interface Clock {
  /** Current time as epoch milliseconds. */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Epoch ms from a Drizzle `timestamp_ms` column value. */
export const toMs = (d: Date): number => d.getTime();
