import {
  type ClockOffset,
  classifySkew,
  estimateClockOffset,
  HealthResponse,
  pickOffset,
  type SkewStatus,
} from "@qpeer/shared";
import { useSyncExternalStore } from "react";

import { config } from "@/config";

/**
 * B9: the phone's clock can be minutes off. The app measures the offset
 * against the server (`GET /v1/health` → `serverTime`) at startup, on every
 * return to the foreground and on "Check again", and uses `serverNow()` for
 * every countdown against server timestamps. A big skew blocks the app
 * (see `ClockGuard`); a small one is just corrected.
 */

const SAMPLES = 3;
const SAMPLE_TIMEOUT_MS = 8_000;

export type ClockState = {
  /** Add to `Date.now()` to get server time. Negative = phone is fast. */
  offsetMs: number;
  status: SkewStatus;
  /** True while a measurement runs. */
  checking: boolean;
  /** False until a measurement succeeded once. */
  measured: boolean;
};

let state: ClockState = {
  offsetMs: 0,
  status: "ok",
  checking: false,
  measured: false,
};
const listeners = new Set<() => void>();

function setState(next: Partial<ClockState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Server-corrected current time (epoch ms). Use for anything compared with server timestamps. */
export function serverNow(): number {
  return Date.now() + state.offsetMs;
}

/** The current clock check result; re-renders when it changes. */
export function useClockStatus(): ClockState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

async function sample(): Promise<ClockOffset | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAMPLE_TIMEOUT_MS);
  try {
    const sentAt = Date.now();
    const res = await fetch(`${config.apiUrl}/v1/health`, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    const receivedAt = Date.now();
    if (!res.ok) return null;
    const body = HealthResponse.safeParse(await res.json());
    if (!body.success) return null;
    return estimateClockOffset({
      sentAt,
      receivedAt,
      serverTime: body.data.serverTime,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let running: Promise<void> | null = null;

/**
 * Measures the offset (a few samples, the fastest round trip wins). If the
 * server cannot be reached the last result stays, so an unreachable server
 * never starts a block (the offline banner covers that).
 */
export function checkClock(): Promise<void> {
  if (running) return running;
  running = (async () => {
    setState({ checking: true });
    try {
      const samples: ClockOffset[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        const s = await sample();
        if (s) samples.push(s);
        // No answer at all: don't wait for more timeouts.
        else if (samples.length === 0) break;
      }
      const best = pickOffset(samples);
      if (best) {
        setState({
          offsetMs: best.offsetMs,
          status: classifySkew(best.offsetMs),
          measured: true,
        });
      }
    } finally {
      setState({ checking: false });
      running = null;
    }
  })();
  return running;
}
