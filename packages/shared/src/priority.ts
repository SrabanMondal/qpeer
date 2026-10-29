/**
 * No imports on purpose: the load-test checker (Node type stripping, no
 * dependencies) imports this file directly.
 *
 * Priority lane, credit counter and missed-turn placement (decided
 * 2026-10-18; HLD §5.2, architecture doc §9.4). Pure functions shared by the
 * QueueDO (the source of the numbers), the purchase preview, the upgrade
 * offer and the load-test checker, so every surface counts the same way.
 *
 * Lanes: triage (always first), priority (ordered by check-in / upgrade
 * time) and regular (join order). `next` calls the triage head; else the
 * priority head when it is due; else the regular head; else (no regulars)
 * the priority head. "Due" is a credit counter: +1 per regular call (capped
 * at N), −N per priority call (never below 0), 0 at session open, triage
 * changes nothing (C1).
 */

const MINUTE_MS = 60_000;

/** Lane order of a queue's waiting tokens. */
export type Lane = "triage" | "priority" | "regular";

/** Credit counter after a call from `lane` (C1). */
export function creditsAfterCall(
  credits: number,
  lane: Lane,
  perRegular: number,
): number {
  const n = Math.max(1, perRegular);
  if (lane === "regular") return Math.min(credits + 1, n);
  if (lane === "priority") return Math.max(0, credits - n);
  return credits;
}

/** Which lane `next` calls from, given which lanes have someone waiting. */
export function nextLane(
  has: { triage: boolean; priority: boolean; regular: boolean },
  credits: number,
  perRegular: number,
): Lane | null {
  if (has.triage) return "triage";
  if (has.priority && (credits >= Math.max(1, perRegular) || !has.regular)) {
    return "priority";
  }
  if (has.regular) return "regular";
  return has.priority ? "priority" : null;
}

/**
 * The predicted call order of everyone waiting: the lanes merged by the
 * credit rule. Each lane is already in its own order. Ignores new arrivals.
 */
export function callOrder<T>(
  lanes: { triage: T[]; priority: T[]; regular: T[] },
  credits: number,
  perRegular: number,
): T[] {
  const out: T[] = [...lanes.triage];
  let c = credits;
  let p = 0;
  let r = 0;
  for (;;) {
    const lane = nextLane(
      {
        triage: false,
        priority: p < lanes.priority.length,
        regular: r < lanes.regular.length,
      },
      c,
      perRegular,
    );
    const item = lane === "priority" ? lanes.priority[p++] : lanes.regular[r++];
    if (lane === null || item === undefined) return out;
    out.push(item);
    c = creditsAfterCall(c, lane, perRegular);
  }
}

/** Priority calls the credit rule makes before the (r+1)-th regular call. */
export function priorityCallsBefore(
  regularAhead: number,
  priorityWaiting: number,
  credits: number,
  perRegular: number,
): number {
  const n = Math.max(1, perRegular);
  let c = Math.min(Math.max(0, credits), n);
  let calls = 0;
  let regs = 0;
  for (;;) {
    if (calls < priorityWaiting && c >= n) {
      calls++;
      c -= n;
      continue;
    }
    if (regs >= regularAhead) return calls;
    regs++;
    c = Math.min(c + 1, n);
  }
}

export interface PeopleAheadRange {
  /** Exact for triage and priority; for regulars the low end (C3). */
  low: number;
  /** Equal to `low` except for regulars while the priority lane is on (C3). */
  high: number;
}

export interface LaneState {
  /** Waiting triage tokens (all of them are ahead of priority and regulars). */
  triageWaiting: number;
  /** Waiting priority tokens (checked in or upgraded). */
  priorityWaiting: number;
  /** Waiting regular tokens. */
  regularWaiting: number;
  /** Credit counter now. */
  credits: number;
  /** N in "1 priority per N regulars". */
  perRegular: number;
  /** Priority lane switched on (the regular range is only shown then). */
  priorityEnabled: boolean;
}

/**
 * People ahead of a waiting regular (C3, PRI-08). Low: regulars ahead +
 * triage + the priority calls the credit rule will make for holders already
 * checked in. High (lane on): as if every N-th call goes to priority —
 * triage + ceil(regularsAhead × (1 + 1/N)) — never below low.
 */
export function regularPeopleAhead(
  s: LaneState,
  regularAhead: number,
): PeopleAheadRange {
  const low =
    s.triageWaiting +
    regularAhead +
    priorityCallsBefore(
      regularAhead,
      s.priorityWaiting,
      s.credits,
      s.perRegular,
    );
  if (!s.priorityEnabled) return { low, high: low };
  const n = Math.max(1, s.perRegular);
  const high = s.triageWaiting + Math.ceil((regularAhead * (n + 1)) / n);
  return { low, high: Math.max(low, high) };
}

/**
 * People ahead of a waiting priority token (exact, PRI-06): triage + the
 * priority tokens ahead in its lane + the regular calls still needed before
 * each of those (and it) is due: max(0, N − credits) + priorityAhead × N,
 * at most the regulars waiting.
 */
export function priorityPeopleAhead(
  s: LaneState,
  priorityAhead: number,
): number {
  const n = Math.max(1, s.perRegular);
  const regularCalls = Math.min(
    s.regularWaiting,
    Math.max(0, n - Math.min(s.credits, n)) + priorityAhead * n,
  );
  return s.triageWaiting + priorityAhead + regularCalls;
}

/**
 * People ahead of someone joining the regular lane now (the "regular wait"
 * of the map, the join screen and the purchase preview).
 */
export function newRegularPeopleAhead(s: LaneState): PeopleAheadRange {
  return regularPeopleAhead(s, s.regularWaiting);
}

/** People ahead of a Priority Pass holder checking in now (end of the lane). */
export function newPriorityPeopleAhead(s: LaneState): number {
  return priorityPeopleAhead(s, s.priorityWaiting);
}

/**
 * R1 / QUE-27 / QUE-06: how many waiting people a rejoin (or a staff Skip)
 * goes behind: K = max(1, ceil(rejoinDelayMin ÷ avgServiceMin)), with the
 * queue's own service time (EWMA Next interval; the configured hint at cold
 * start). An average under 1 s is treated as 1 s (no division by zero).
 */
export function rejoinBehind(
  rejoinDelayMin: number,
  avgServiceMs: number,
): number {
  const avg = Math.max(1_000, avgServiceMs);
  return Math.max(1, Math.ceil((rejoinDelayMin * MINUTE_MS) / avg));
}

/** True while "I'm here" still gets the rejoin-delay position (else: the end of the line). */
export function withinLateWindow(
  missedAt: number,
  lateWindowMin: number | null,
  now: number,
): boolean {
  return lateWindowMin === null || now - missedAt <= lateWindowMin * MINUTE_MS;
}

/** End of the late window, or null for "no limit". */
export function lateWindowEndsAt(
  missedAt: number,
  lateWindowMin: number | null,
): number | null {
  return lateWindowMin === null ? null : missedAt + lateWindowMin * MINUTE_MS;
}

/** Whole minutes saved between two wait ranges (midpoints), never negative. */
export function savingMinutes(
  regular: { lowMs: number; highMs: number },
  priority: { lowMs: number; highMs: number },
): number {
  const r = (regular.lowMs + regular.highMs) / 2;
  const p = (priority.lowMs + priority.highMs) / 2;
  return Math.max(0, Math.floor((r - p) / MINUTE_MS));
}

/**
 * C2: the upgrade offer is shown only when the saving reaches the business's
 * threshold — and never as "save ~0 min" next to a price.
 */
export function showSaving(savingMin: number, thresholdMin: number): boolean {
  return savingMin >= Math.max(1, thresholdMin);
}

// ---------- R2 check code ----------

/** No look-alikes: no 0/O, 1/I/L. 31 characters. */
export const CHECK_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CHECK_CODE_LENGTH = 4;

/** A random 4-character check code ("K7P2"). */
export function makeCheckCode(
  random: (n: number) => Uint8Array = (n) =>
    crypto.getRandomValues(new Uint8Array(n)),
): string {
  // Rejection sampling keeps the characters uniform (248 = 8 × 31).
  let out = "";
  while (out.length < CHECK_CODE_LENGTH) {
    for (const b of random(8)) {
      if (b < 248 && out.length < CHECK_CODE_LENGTH) {
        out += CHECK_CODE_ALPHABET[b % CHECK_CODE_ALPHABET.length];
      }
    }
  }
  return out;
}

/** Normalises what staff typed ("k7p2 " → "K7P2"); null when it can't be a code. */
export function normalizeCheckCode(text: string): string | null {
  const t = text.trim().toUpperCase();
  if (t.length !== CHECK_CODE_LENGTH) return null;
  for (const ch of t) if (!CHECK_CODE_ALPHABET.includes(ch)) return null;
  return t;
}
