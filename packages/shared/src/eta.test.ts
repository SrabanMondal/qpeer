import { describe, expect, it } from "vitest";
import {
  BE_BACK_BUFFER_MS,
  capInterval,
  EMPTY_EWMA,
  ETA_ALPHA,
  estimateWait,
  etaHit,
  ewmaUpdate,
  leaveHomeBy,
  median,
  serviceRate,
} from "./eta";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 15, 5, 0);

describe("ETA math (QUE-13/14/15)", () => {
  it("median of odd/even/empty lists", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("QUE-13: intervals are capped at 5x the median of recent intervals", () => {
    expect(capInterval(100 * MIN, [])).toBe(100 * MIN);
    expect(capInterval(100 * MIN, [2 * MIN, 3 * MIN, 4 * MIN])).toBe(15 * MIN);
    expect(capInterval(4 * MIN, [2 * MIN, 3 * MIN, 4 * MIN])).toBe(4 * MIN);
    expect(capInterval(-5, [MIN])).toBe(0);
  });

  it("QUE-13: EWMA update with alpha 0.3 and matching variance", () => {
    let s = ewmaUpdate(EMPTY_EWMA, 10 * MIN);
    expect(s).toEqual({ mean: 10 * MIN, variance: 0, count: 1 });
    s = ewmaUpdate(s, 20 * MIN);
    expect(s.mean).toBeCloseTo(10 * MIN + ETA_ALPHA * 10 * MIN, 6);
    // var = (1-a)(0 + diff * a*diff)
    expect(s.variance).toBeCloseTo(0.7 * (10 * MIN) * (3 * MIN), 0);
    expect(s.count).toBe(2);
    // identical samples shrink the variance
    const steady = ewmaUpdate(ewmaUpdate(s, s.mean), s.mean);
    expect(steady.variance).toBeLessThan(s.variance);
  });

  it("QUE-13: cold start uses serviceMinutesHint until 3 intervals exist", () => {
    let s = EMPTY_EWMA;
    expect(serviceRate(s, 7)).toMatchObject({
      meanMs: 7 * MIN,
      coldStart: true,
    });
    s = ewmaUpdate(ewmaUpdate(s, 2 * MIN), 2 * MIN);
    expect(serviceRate(s, 7).coldStart).toBe(true);
    s = ewmaUpdate(s, 2 * MIN);
    expect(serviceRate(s, 7)).toMatchObject({
      meanMs: 2 * MIN,
      coldStart: false,
    });
  });

  it("QUE-14: range is ordered low < expected < high and widens with k", () => {
    const rate = { meanMs: 4 * MIN, sigmaMs: 2 * MIN, coldStart: false };
    const near = estimateWait({
      now: NOW,
      peopleAhead: 0,
      rate,
      intervalStartedAt: null,
      pausedInIntervalMs: 0,
    });
    const far = estimateWait({
      now: NOW,
      peopleAhead: 8,
      rate,
      intervalStartedAt: null,
      pausedInIntervalMs: 0,
    });
    for (const e of [near, far]) {
      expect(e.lowMs).toBeGreaterThanOrEqual(NOW);
      expect(e.lowMs).toBeLessThan(e.highMs);
      expect(e.expectedMs).toBeLessThanOrEqual(e.highMs);
      expect(e.expectedMs).toBeGreaterThanOrEqual(e.lowMs);
    }
    expect(far.expectedMs).toBe(NOW + 9 * 4 * MIN);
    expect(far.highMs - far.lowMs).toBeGreaterThan(near.highMs - near.lowMs);
    // 1.28 * sigma * sqrt(9) = 3.84 * 2 min
    expect(far.highMs - far.expectedMs).toBe(Math.round(1.28 * 2 * MIN * 3));
  });

  it("QUE-14: never a single number even with zero variance; low clamped to now", () => {
    const e = estimateWait({
      now: NOW,
      peopleAhead: 0,
      rate: { meanMs: 30_000, sigmaMs: 0, coldStart: false },
      intervalStartedAt: NOW - 10 * MIN,
      pausedInIntervalMs: 0,
    });
    expect(e.expectedMs).toBe(NOW);
    expect(e.lowMs).toBe(NOW);
    expect(e.highMs).toBeGreaterThan(e.lowMs);
  });

  it("QUE-07/13: elapsed time of the current interval is subtracted, paused time is not", () => {
    const rate = { meanMs: 10 * MIN, sigmaMs: MIN, coldStart: false };
    const base = {
      now: NOW,
      peopleAhead: 1,
      rate,
      intervalStartedAt: NOW - 6 * MIN,
    };
    const active = estimateWait({ ...base, pausedInIntervalMs: 0 });
    const paused = estimateWait({ ...base, pausedInIntervalMs: 4 * MIN });
    expect(active.expectedMs).toBe(NOW + 20 * MIN - 6 * MIN);
    expect(paused.expectedMs).toBe(NOW + 20 * MIN - 2 * MIN);
  });

  it("QUE-15: be-back-by and leave-home-by", () => {
    const e = estimateWait({
      now: NOW,
      peopleAhead: 4,
      rate: { meanMs: 5 * MIN, sigmaMs: MIN, coldStart: false },
      intervalStartedAt: null,
      pausedInIntervalMs: 0,
    });
    expect(e.beBackByMs).toBe(e.expectedMs - BE_BACK_BUFFER_MS);
    // 10 km at 20 km/h = 30 min, + 10 min buffer
    expect(leaveHomeBy(e.expectedMs, 10_000)).toBe(e.expectedMs - 40 * MIN);
  });

  it("ETA hit is inclusive of both ends", () => {
    expect(etaHit(5, 5, 10)).toBe(true);
    expect(etaHit(10, 5, 10)).toBe(true);
    expect(etaHit(11, 5, 10)).toBe(false);
  });
});
