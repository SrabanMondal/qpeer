/**
 * Wait-estimate math (backend architecture doc §9.6). Pure functions: the
 * QueueDO is the source of the numbers it sends, and the app can use the same
 * functions (e.g. leave-home-by, which needs the phone's own distance).
 */

const MINUTE_MS = 60_000;

/** EWMA smoothing factor. */
export const ETA_ALPHA = 0.3;
/** Intervals are capped at this multiple of the median of recent intervals. */
export const ETA_OUTLIER_FACTOR = 5;
/** How many recent intervals the median is taken over. */
export const ETA_INTERVAL_WINDOW = 50;
/** Below this many recorded intervals the queue's `serviceMinutesHint` is used. */
export const ETA_MIN_INTERVALS = 3;
/** z-value for an ~80% two-sided range. */
export const ETA_Z = 1.28;
/** Cold start: σ is assumed to be this share of the hinted service time. */
export const ETA_COLD_SIGMA_SHARE = 0.5;
/** The range is never narrower than ±max(1 min, 10% of the expected wait). */
export const ETA_MIN_HALF_WIDTH_MS = MINUTE_MS;
export const ETA_MIN_HALF_WIDTH_SHARE = 0.1;
/** Be-back-by = expected call − this buffer. */
export const BE_BACK_BUFFER_MS = 5 * MINUTE_MS;
/** Leave-home-by = expected call − travel time − this buffer. */
export const LEAVE_HOME_BUFFER_MS = 10 * MINUTE_MS;
/** Assumed travel speed for leave-home-by (straight-line distance). */
export const ASSUMED_SPEED_KMH = 20;

/** Running EWMA state of Next-to-Next intervals (ms). */
export interface EwmaState {
  mean: number;
  variance: number;
  /** Number of intervals folded in so far. */
  count: number;
}

export const EMPTY_EWMA: EwmaState = { mean: 0, variance: 0, count: 0 };

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Caps an interval at 5× the median of the recent ones (no cap without history). */
export function capInterval(
  intervalMs: number,
  recentMs: readonly number[],
): number {
  const clean = Math.max(0, intervalMs);
  const m = median(recentMs.slice(-ETA_INTERVAL_WINDOW));
  if (m === null || m <= 0) return clean;
  return Math.min(clean, ETA_OUTLIER_FACTOR * m);
}

/**
 * Folds one interval into the EWMA with matching exponentially weighted
 * variance: `diff = x − mean; mean += α·diff; var = (1−α)(var + α·diff²)`.
 */
export function ewmaUpdate(state: EwmaState, intervalMs: number): EwmaState {
  if (state.count === 0) {
    return { mean: intervalMs, variance: 0, count: 1 };
  }
  const diff = intervalMs - state.mean;
  const incr = ETA_ALPHA * diff;
  return {
    mean: state.mean + incr,
    variance: (1 - ETA_ALPHA) * (state.variance + diff * incr),
    count: state.count + 1,
  };
}

export interface ServiceRate {
  /** Expected time between two calls (ms). */
  meanMs: number;
  /** Standard deviation of that time (ms). */
  sigmaMs: number;
  /** True while fewer than ETA_MIN_INTERVALS intervals exist. */
  coldStart: boolean;
}

/** The interval estimate to use: EWMA once warm, the configured hint before. */
export function serviceRate(
  state: EwmaState,
  serviceMinutesHint: number,
): ServiceRate {
  if (state.count < ETA_MIN_INTERVALS) {
    const meanMs = serviceMinutesHint * MINUTE_MS;
    return { meanMs, sigmaMs: meanMs * ETA_COLD_SIGMA_SHARE, coldStart: true };
  }
  return {
    meanMs: state.mean,
    sigmaMs: Math.sqrt(Math.max(0, state.variance)),
    coldStart: false,
  };
}

export interface WaitInput {
  now: number;
  /** Waiting tokens before this one. */
  peopleAhead: number;
  rate: ServiceRate;
  /**
   * Start of the current interval (last call, or session open when nothing was
   * called yet). Null = nothing to subtract.
   */
  intervalStartedAt: number | null;
  /** Paused time inside the current interval (ms), excluded from "elapsed". */
  pausedInIntervalMs: number;
}

export interface WaitEstimate {
  /** Expected call time (epoch ms), never before `now`. */
  expectedMs: number;
  lowMs: number;
  highMs: number;
  /** Expected call − 5 min, never before `now`. */
  beBackByMs: number;
}

/**
 * For `k = peopleAhead + 1`: expected = now + k·mean − elapsed (elapsed = active
 * time of the current interval), range = expected ± 1.28·σ·√k (at least
 * ±max(1 min, 10% of k·mean)), low clamped to now.
 */
export function estimateWait(input: WaitInput): WaitEstimate {
  const { now, rate } = input;
  const k = Math.max(0, input.peopleAhead) + 1;
  const elapsed =
    input.intervalStartedAt === null
      ? 0
      : Math.max(
          0,
          now - input.intervalStartedAt - Math.max(0, input.pausedInIntervalMs),
        );
  const expectedMs = Math.max(now, Math.round(now + k * rate.meanMs - elapsed));
  const halfWidth = Math.max(
    ETA_Z * rate.sigmaMs * Math.sqrt(k),
    ETA_MIN_HALF_WIDTH_MS,
    ETA_MIN_HALF_WIDTH_SHARE * k * rate.meanMs,
  );
  const lowMs = Math.max(now, Math.round(expectedMs - halfWidth));
  const highMs = Math.max(lowMs + 1, Math.round(expectedMs + halfWidth));
  return {
    expectedMs,
    lowMs,
    highMs,
    beBackByMs: Math.max(now, expectedMs - BE_BACK_BUFFER_MS),
  };
}

/** Leave-home-by = expected − straight-line distance ÷ 20 km/h − 10 min. */
export function leaveHomeBy(expectedMs: number, distanceM: number): number {
  const travelMs =
    (Math.max(0, distanceM) / (ASSUMED_SPEED_KMH * 1000)) * 3_600_000;
  return Math.round(expectedMs - travelMs - LEAVE_HOME_BUFFER_MS);
}

/** ETA accuracy: did the call fall inside the range shown at join? */
export function etaHit(calledAt: number, lowMs: number, highMs: number) {
  return calledAt >= lowMs && calledAt <= highMs;
}
