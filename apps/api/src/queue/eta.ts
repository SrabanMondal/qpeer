import {
  estimateWait,
  type ServiceRate,
  serviceRate,
  type WaitEstimate,
} from "@qpeer/shared";
import type { QueueStore } from "./storage";

/**
 * DO side of the wait estimate (§9.6). The math is in `@qpeer/shared/eta`;
 * this file only reads the inputs from DO storage.
 */
export interface EtaContext {
  rate: ServiceRate;
  intervalStartedAt: number | null;
  pausedInIntervalMs: number;
}

/** Paused time so far in this session, including an ongoing pause. */
export function pausedTotalNow(store: QueueStore, now: number): number {
  const since = store.get("paused_since");
  return store.get("paused_total_ms") + (since === null ? 0 : now - since);
}

export function etaContext(store: QueueStore, now: number): EtaContext {
  return {
    rate: serviceRate(
      store.get("ewma"),
      store.get("settings").serviceMinutesHint,
    ),
    intervalStartedAt: store.get("last_call_at") ?? store.get("opened_at"),
    pausedInIntervalMs:
      pausedTotalNow(store, now) - store.get("paused_at_last_call"),
  };
}

export function estimateFor(
  ctx: EtaContext,
  now: number,
  peopleAhead: number,
): WaitEstimate {
  return estimateWait({ now, peopleAhead, ...ctx });
}
