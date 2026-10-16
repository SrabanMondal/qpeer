/**
 * One rule and one text for "is it open?" (B16, INC-043) and "how long is the
 * wait?" (B19, INC-046) on every surface: map pill, map card, list row,
 * business page, join screen, ticket and console. Pure functions, no React.
 */

const MINUTE_MS = 60_000;

// ---------- open ----------

export type OpenKind =
  | "open"
  | "open_after_hours"
  | "paused"
  | "queue_not_open"
  | "closed";

export type OpenLook = {
  kind: OpenKind;
  label: string;
  tone: "success" | "warning" | "neutral";
};

/**
 * The queue state decides whether a customer can join; the hours are only
 * information. `status` is a queue's live status or a business's marker
 * status (`open` = some queue open and not paused). `withinHours` = inside
 * today's hours (IST), when known.
 */
export function openLook(
  status: "open" | "paused" | "closed",
  withinHours: boolean | undefined,
): OpenLook {
  if (status === "open") {
    return withinHours === false
      ? {
          kind: "open_after_hours",
          label: "Open (after usual hours)",
          tone: "success",
        }
      : { kind: "open", label: "Open now", tone: "success" };
  }
  if (status === "paused") {
    return { kind: "paused", label: "Paused", tone: "warning" };
  }
  return withinHours
    ? { kind: "queue_not_open", label: "Queue not open", tone: "neutral" }
    : { kind: "closed", label: "Closed now", tone: "neutral" };
}

// ---------- wait ----------

/** What every wait text is computed from: a live summary or a map snapshot. */
export type WaitInputs = {
  waiting: number;
  /** Tokens at a counter; unknown (older server) counts as 0. */
  inService?: number;
  /** Wait range (durations) for someone joining, measured at `updatedAt`. */
  waitLowMs: number | null;
  waitHighMs: number | null;
  /** When the durations were measured; null/undefined = now. */
  updatedAt?: number | null;
};

/**
 * The wait range as durations from `now`. The QueueDO's estimate falls
 * linearly with time between changes (expected = last call + k·mean), so
 * subtracting the snapshot's age gives the same numbers the DO would give
 * now: a 30 s old snapshot and a live summary agree (coordinator report
 * 2026-10-16: pill, card and join screen showed three different waits).
 */
export function waitRangeAt(
  s: WaitInputs,
  now: number,
): { lowMs: number; highMs: number } | null {
  if (s.waitLowMs === null || s.waitHighMs === null) return null;
  const age = s.updatedAt == null ? 0 : Math.max(0, now - s.updatedAt);
  return {
    lowMs: Math.max(0, s.waitLowMs - age),
    highMs: Math.max(0, s.waitHighMs - age),
  };
}

/** A duration as "~25 min", "~1 h 10 min", "< 1 min" (midpoint of a range). */
export function approxDuration(lowMs: number, highMs: number): string {
  const mid = Math.round(
    (Math.max(0, lowMs) + Math.max(0, highMs)) / 2 / MINUTE_MS,
  );
  if (mid <= 0) return "< 1 min";
  if (mid < 60) return `~${mid} min`;
  const h = Math.floor(mid / 60);
  const m = mid % 60;
  return m === 0 ? `~${h} h` : `~${h} h ${m} min`;
}

/**
 * The wait for someone joining now:
 * - nobody waiting and nobody at a counter → "No wait";
 * - nobody waiting, someone at a counter → "Next in ~5 min";
 * - people waiting → "~25 min";
 * - null when the estimate is unknown (closed queue).
 */
export function waitText(s: WaitInputs, now: number): string | null {
  const inService = s.inService ?? 0;
  if (s.waiting <= 0 && inService <= 0) return "No wait";
  const r = waitRangeAt(s, now);
  if (s.waiting <= 0) {
    return r ? `Next in ${approxDuration(r.lowMs, r.highMs)}` : "You'd be next";
  }
  return r ? approxDuration(r.lowMs, r.highMs) : null;
}

/**
 * Waiting count plus wait, the same words everywhere: "No wait",
 * "Next in ~5 min", "3 waiting · ~25 min" (compact for map pills:
 * "3 · ~25 min").
 */
export function waitSummary(
  s: WaitInputs,
  now: number,
  compact = false,
): string {
  const wait = waitText(s, now);
  if (s.waiting <= 0) return wait ?? "No wait";
  if (!wait) return `${s.waiting} waiting`;
  return compact ? `${s.waiting} · ${wait}` : `${s.waiting} waiting · ${wait}`;
}
