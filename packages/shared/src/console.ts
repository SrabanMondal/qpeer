import type { ConsoleState, ConsoleToken } from "./queue";

/**
 * Pure helpers for the staff console (no React Native imports, so they are
 * unit-tested here).
 */

/**
 * Label of the token the last NEXT called, for the Undo bar ("Called #P1").
 * The most recently called token still in the console (at a counter, late in
 * grace, or missed), so it stays right after a No-show, when "Now serving"
 * is already empty. Same `label` as the console lists (`47`, `P1`, `T2`).
 * Null when no called token is known.
 */
export function lastCalledLabel(
  state: Pick<ConsoleState, "serving" | "grace" | "missed">,
): string | null {
  let best: ConsoleToken | null = null;
  for (const t of [...state.serving, ...state.grace, ...(state.missed ?? [])]) {
    if (t.calledAt === null) continue;
    if (!best || (best.calledAt ?? 0) < t.calledAt) best = t;
  }
  return best?.label ?? null;
}

/** What "Close for the day" does to the active tickets (console dialog). */
export interface CloseSummary {
  /** Active tickets that end (waiting, called, late). */
  ending: number;
  /** Waiting tickets valid beyond today: kept for the next session (C4). */
  kept: number;
  /** Paid tickets among `ending`: refunded in full automatically. */
  paidRefunded: number;
  /** Paid Priority Passes not checked in (BOOKED): not ended by a close. */
  booked: number;
}

/**
 * C4 + Step 4: a close ends every active ticket except waiting ones still
 * valid after `now` (they carry over); each paid ticket it ends (a
 * reservation, a checked-in or upgraded pass, at a counter or late) is
 * refunded in full. BOOKED passes are not touched by a close.
 */
export function closeSummary(
  state: Pick<ConsoleState, "serving" | "grace" | "waiting" | "counts">,
  now: number,
): CloseSummary {
  const keeps = (t: ConsoleToken) =>
    t.expiresAt != null && t.expiresAt > now && t.lane !== "triage";
  const ending = [
    ...state.waiting.filter((t) => !keeps(t)),
    ...state.serving,
    ...state.grace,
  ];
  return {
    ending: state.counts.total - state.waiting.filter(keeps).length,
    kept: state.waiting.filter(keeps).length,
    paidRefunded: ending.filter((t) => t.paid).length,
    booked: state.counts.booked ?? 0,
  };
}
