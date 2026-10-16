import type { TokenClass } from "@qpeer/shared";
import { CLASS_RANK, type QueueStore, RANK_SPAN, SEQ_STEP } from "./storage";

/**
 * Queue order (architecture doc §9.4): `sortKey = classRank · 1e15 + seq · 1024`.
 * The doc's `classRank · 1e12 + sequence` is scaled so that skips can take a
 * key between two neighbours without renumbering (gaps of 1024); when a gap is
 * used up, the waiting list is renumbered (cheap: DO-local SQLite).
 *
 * People ahead = `COUNT(*) WHERE state = 'WAITING' AND sort_key < mine`
 * (`QueueStore.peopleAhead`, index on `(state, sort_key)`).
 */

/** Skipped tokens go behind the next N waiting tokens (decision recorded in §23). */
export const SKIP_BEHIND = 3;

/** Lower bound for "from the head of the queue". */
export const BEFORE_ALL = Number.MIN_SAFE_INTEGER;

/** Sort key for a newly allocated token: end of its class. */
export function allocateSortKey(store: QueueStore, cls: TokenClass): number {
  const seq = store.get("seq") + 1;
  store.set("seq", seq);
  return CLASS_RANK[cls] * RANK_SPAN + seq * SEQ_STEP;
}

/**
 * QUE-06: new sort key for a skipped token — after the next `SKIP_BEHIND`
 * waiting tokens, or at the very end when fewer remain. A WAITING token counts
 * from its own place; a CALLED token re-enters behind the first N waiting.
 */
export function skipSortKey(store: QueueStore, tokenId: string): number {
  const me = store.token(tokenId);
  const key = placeBehind(store, tokenId);
  if (!me) return key;
  // A skip only ever moves a token back: it may land behind lower classes
  // (a skipped triage token goes behind the next 3 people, whoever they are),
  // but never inside a higher class's range, or later arrivals of that class
  // would queue behind it (Step 3.5 G1).
  const floor = CLASS_RANK[me.cls] * RANK_SPAN;
  if (key >= floor) return key;
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = store
      .waitingAfter(floor - 1, 2)
      .find((t) => t.id !== tokenId)?.sort_key;
    if (next === undefined) {
      const seq = store.get("seq") + 1;
      store.set("seq", seq);
      return floor + seq * SEQ_STEP;
    }
    // Head of its own class, behind every higher-class token.
    if (next - floor >= 1) return Math.floor((floor + next - 1) / 2);
    store.renumberWaiting();
  }
  throw new Error("skip: could not find a sort key");
}

/** "Behind the next SKIP_BEHIND waiting tokens, or the end", ignoring class. */
function placeBehind(store: QueueStore, tokenId: string): number {
  for (let attempt = 0; attempt < 2; attempt++) {
    const me = store.token(tokenId);
    const from = me?.state === "WAITING" ? me.sort_key : BEFORE_ALL;
    const after = store
      .waitingAfter(from, SKIP_BEHIND + 2)
      .filter((t) => t.id !== tokenId);
    if (after.length <= SKIP_BEHIND) {
      // To the end: a fresh sequence in the rank of the last waiting token.
      const last = store.maxWaitingSortKey();
      const seq = store.get("seq") + 1;
      store.set("seq", seq);
      if (last === null) return CLASS_RANK.regular * RANK_SPAN + seq * SEQ_STEP;
      const rank = Math.floor(last / RANK_SPAN);
      return Math.max(rank * RANK_SPAN + seq * SEQ_STEP, last + SEQ_STEP);
    }
    const a = after[SKIP_BEHIND - 1].sort_key;
    const b = after[SKIP_BEHIND].sort_key;
    if (b - a >= 2) return Math.floor((a + b) / 2);
    // Gap used up: space the keys out again and retry.
    store.renumberWaiting();
  }
  throw new Error("skip: could not find a sort key");
}
