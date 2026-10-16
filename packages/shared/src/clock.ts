import { z } from "zod";

/** GET /v1/health (public). `serverTime` is the server clock in epoch ms (B9). */
export const HealthResponse = z.object({
  ok: z.boolean(),
  env: z.string(),
  serverTime: z.number(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;

/** Skew up to this much is ignored (`ok`). */
export const CLOCK_OK_MS = 30_000;
/** Skew above this blocks the app until the phone's time is fixed. */
export const CLOCK_BLOCKING_MS = 2 * 60_000;
/** Samples with a longer round trip are too vague to use. */
export const CLOCK_MAX_RTT_MS = 10_000;

export type ClockSample = {
  /** Phone clock (epoch ms) when the request was sent. */
  sentAt: number;
  /** Phone clock (epoch ms) when the response arrived. */
  receivedAt: number;
  /** Server clock (epoch ms) from the response. */
  serverTime: number;
};

export type ClockOffset = {
  /** Add to the phone clock to get server time. Negative = phone is fast. */
  offsetMs: number;
  rttMs: number;
};

export type SkewStatus = "ok" | "minor" | "blocking";

/**
 * Offset of the server clock from the phone clock, assuming the server read
 * its clock halfway through the round trip.
 */
export function estimateClockOffset({
  sentAt,
  receivedAt,
  serverTime,
}: ClockSample): ClockOffset {
  return {
    offsetMs: serverTime - (sentAt + receivedAt) / 2,
    rttMs: receivedAt - sentAt,
  };
}

/** The sample with the shortest round trip, or null if none is usable. */
export function pickOffset(
  samples: readonly ClockOffset[],
): ClockOffset | null {
  let best: ClockOffset | null = null;
  for (const s of samples) {
    if (!Number.isFinite(s.offsetMs) || s.rttMs < 0) continue;
    if (s.rttMs > CLOCK_MAX_RTT_MS) continue;
    if (!best || s.rttMs < best.rttMs) best = s;
  }
  return best;
}

/** How bad a clock offset is. */
export function classifySkew(offsetMs: number): SkewStatus {
  const abs = Math.abs(offsetMs);
  if (abs <= CLOCK_OK_MS) return "ok";
  if (abs <= CLOCK_BLOCKING_MS) return "minor";
  return "blocking";
}
