import type {
  JoinMethod,
  LiveStatus,
  TokenState,
  TokenView,
} from "@qpeer/shared";
import { useEffect, useState } from "react";

import type { BadgeTone } from "@/components/ui/badge";
import type { StatusTone } from "@/components/ui/status-banner";
import { serverNow, useClockStatus } from "@/lib/clock";

const MINUTE_MS = 60_000;

/** "5 min", "1 h", "1 h 20 min" */
export function formatMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/**
 * A wait range given as two durations (ms): "about 25–35 min",
 * "about 1 h – 1 h 20 min", or "less than a minute".
 */
export function formatWaitRange(lowMs: number, highMs: number): string {
  const low = Math.max(0, Math.round(lowMs / MINUTE_MS));
  const high = Math.max(low, Math.round(highMs / MINUTE_MS));
  if (high <= 0) return "less than a minute";
  if (low === high) return `about ${formatMinutes(high)}`;
  if (high < 60) return `about ${low}–${high} min`;
  return `about ${formatMinutes(low)} – ${formatMinutes(high)}`;
}

/** Epoch ms → "11:15 AM" (phone's clock, 12-hour, design guide §6). */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Epoch ms → "Mon 20 Oct, 5:30 PM". */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}, ${formatClock(ms)}`;
}

/**
 * How old a saved view is, by the phone's clock (both ends are phone time):
 * "just now", "3 min ago", "2 h ago", "yesterday".
 */
export function formatAge(savedAt: number, now = Date.now()): string {
  const min = Math.floor(Math.max(0, now - savedAt) / MINUTE_MS);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return h < 48 ? "yesterday" : `${Math.floor(h / 24)} days ago`;
}

/** Remaining ms → "4:05" (never negative). */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 850 → "850 m", 2300 → "2.3 km". */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export const METHOD_LABELS: Record<JoinMethod, string> = {
  walkin: "Walk-in",
  remote: "Reserved",
  staff: "Staff",
};

/** Status banner for a queue's live status (console, join screen). */
export function liveStatusLook(status: LiveStatus): {
  tone: StatusTone;
  title: string;
} {
  switch (status) {
    case "open":
      return { tone: "active", title: "Open" };
    case "paused":
      return { tone: "paused", title: "Paused" };
    default:
      return { tone: "closed", title: "Closed" };
  }
}

/** Ticket status badge (TOK-04). A waiting token in a paused queue shows "Paused". */
export function tokenStatusBadge(
  t: Pick<TokenView, "state"> & { queueStatus?: LiveStatus },
): { label: string; tone: BadgeTone } {
  const map: Record<TokenState, { label: string; tone: BadgeTone }> = {
    BOOKED: { label: "Booked", tone: "success" },
    MISSED: { label: "Missed", tone: "warning" },
    WAITING: { label: "Waiting", tone: "success" },
    CALLED: { label: "Your turn", tone: "success" },
    GRACE: { label: "Late — come now", tone: "warning" },
    SERVED: { label: "Served", tone: "neutral" },
    EXPIRED: { label: "Expired", tone: "neutral" },
    LEFT: { label: "Left", tone: "neutral" },
    CANCELLED: { label: "Cancelled", tone: "neutral" },
  };
  if (t.state === "WAITING" && t.queueStatus === "paused") {
    return { label: "Queue paused", tone: "warning" };
  }
  return map[t.state];
}

/**
 * The current server-corrected time (B9, `serverNow()`), ticking every
 * `intervalMs` while `active`. Compare it with server timestamps only.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(serverNow);
  // A new clock measurement shifts the time at once, even when not ticking.
  const { offsetMs } = useClockStatus();
  useEffect(() => {
    setNow(Date.now() + offsetMs);
    if (!active) return;
    const timer = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, offsetMs]);
  return now;
}
