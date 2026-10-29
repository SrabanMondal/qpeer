import {
  type Lane,
  rejoinBehind,
  serviceRate,
  type TokenClass,
} from "@qpeer/shared";
import {
  CLASS_RANK,
  type QueueStore,
  RANK_SPAN,
  SEQ_STEP,
  type TokenRow,
} from "./storage";

/**
 * Queue order (architecture doc §9.4): `sortKey = classRank · 1e15 + seq · 1024`.
 * The rank of a key is its **lane**: 0 triage, 1 priority (checked-in passes
 * and upgrades, by check-in/upgrade time), 2 regular (join order). Gaps of
 * 1024 let a skip or a rejoin take a key between two neighbours; when a gap
 * is used up, the waiting list is renumbered (cheap: DO-local SQLite).
 *
 * `next` picks between lanes by the credit rule (`@qpeer/shared` priority.ts),
 * so the call order is the lanes merged, not the raw key order.
 */

/** Lower bound for "from the head of the queue". */
export const BEFORE_ALL = Number.MIN_SAFE_INTEGER;

export const LANE_BY_RANK: Lane[] = ["triage", "priority", "regular"];

/** Lane rank (0, 1, 2) of a sort key. */
export const rankOf = (sortKey: number): number =>
  Math.min(2, Math.max(0, Math.floor(sortKey / RANK_SPAN)));

export const laneOf = (sortKey: number): Lane => LANE_BY_RANK[rankOf(sortKey)];

/** Sort key for a newly allocated token: end of its class. */
export function allocateSortKey(store: QueueStore, cls: TokenClass): number {
  const seq = store.get("seq") + 1;
  store.set("seq", seq);
  return CLASS_RANK[cls] * RANK_SPAN + seq * SEQ_STEP;
}

/**
 * R1 / QUE-06: K = max(1, ceil(rejoinDelayMin ÷ avgServiceMin)), with the
 * queue's EWMA Next interval (the configured service time at cold start).
 * Taken at the moment of the skip or rejoin.
 */
export function currentRejoinK(store: QueueStore): number {
  const settings = store.get("settings");
  const rate = serviceRate(store.get("ewma"), settings.serviceMinutesHint);
  return rejoinBehind(settings.rejoinDelayMin, rate.meanMs);
}

/**
 * New sort key behind K waiting people (QUE-06 skip, QUE-27 rejoin), or at
 * the end when fewer wait (or `toEnd`). Regular and priority tokens stay in
 * their own lane: they count only their own class and never land inside a
 * higher class's range (G1). A triage token counts everyone and may go
 * behind lower classes. A WAITING token counts from its own place; a
 * CALLED or MISSED token from the head of its lane.
 */
export function placeBehind(
  store: QueueStore,
  tokenId: string,
  k: number,
  toEnd = false,
): number {
  for (let attempt = 0; attempt < 2; attempt++) {
    const me = store.token(tokenId);
    if (!me) throw new Error("placeBehind: token missing");
    const triage = me.cls === "triage";
    const rank = CLASS_RANK[me.cls];
    const below = triage ? Number.MAX_SAFE_INTEGER : (rank + 1) * RANK_SPAN;
    const from =
      me.state === "WAITING"
        ? me.sort_key
        : triage
          ? BEFORE_ALL
          : rank * RANK_SPAN - 1;
    const after = toEnd
      ? []
      : store
          .waitingAfterBelow(from, below, k + 2)
          .filter((t) => t.id !== tokenId);
    if (toEnd || after.length <= k) return endKey(store, me, below);
    const a = after[k - 1].sort_key;
    const b = after[k].sort_key;
    // Across a lane boundary (triage only): stay right behind `a`, in its lane.
    if (rankOf(a) !== rankOf(b) && b - a >= 2) return a + 1;
    if (b - a >= 2) return Math.floor((a + b) / 2);
    // Gap used up: space the keys out again and retry.
    store.renumberWaiting();
  }
  throw new Error("placeBehind: could not find a sort key");
}

/** A fresh key at the end of the token's lane (triage: the end of the whole queue). */
function endKey(store: QueueStore, me: TokenRow, below: number): number {
  const last = store.maxWaitingBelow(below, me.id);
  const seq = store.get("seq") + 1;
  store.set("seq", seq);
  if (me.cls === "triage") {
    if (last === null) return CLASS_RANK.regular * RANK_SPAN + seq * SEQ_STEP;
    const rank = rankOf(last);
    return Math.max(rank * RANK_SPAN + seq * SEQ_STEP, last + SEQ_STEP);
  }
  const rank = CLASS_RANK[me.cls];
  const fresh = rank * RANK_SPAN + seq * SEQ_STEP;
  return last === null || rankOf(last) !== rank
    ? fresh
    : Math.max(fresh, last + SEQ_STEP);
}
