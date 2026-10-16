import type { LiveClient, TokenObservation } from "./live.ts";

/** What the simulator remembers about the run (its event log). Never holds coordinates. */

export interface SimUser {
  sub: string;
  token: string;
  registered: boolean;
  hasDevice: boolean;
}

export interface SimQueue {
  id: string;
  businessId: string;
  ownerToken: string;
  /** Console state kept by the staff loop (from action responses). */
  paused: boolean;
  lastNextAt: number;
  /** Token called by the most recent Next (for Undo bookkeeping). */
  lastCalledId: string | null;
}

export interface SimBusiness {
  id: string;
  ownerToken: string;
  queues: SimQueue[];
}

export interface SimToken {
  id: string;
  queueId: string;
  user: SimUser | null;
  number: number;
  series: string;
  joinedAt: number;
  observations: TokenObservation[];
  live: LiveClient | null;
  leftOk: boolean;
}

export type QueueEventKind =
  | "open"
  | "next"
  | "undo"
  | "skip"
  | "no-show"
  | "admit"
  | "served"
  | "triage"
  | "pause"
  | "resume"
  | "join"
  | "leave"
  | "close";

export interface QueueEvent {
  at: number;
  /** Time the response arrived (the change happened in between). */
  doneAt: number;
  kind: QueueEventKind;
  tokenId: string | null;
  ok: boolean;
  status: number;
  code: string | null;
}

export type ProbeKind = "too_far" | "mock_location" | "no_location_fix";

export interface ProbeResult {
  kind: ProbeKind | "already_in_queue";
  expectedStatus: number;
  status: number;
  code: string | null;
}

/** Waiting list as one console response showed it (consistent snapshot). */
export interface ConsoleSnapshot {
  queueId: string;
  at: number;
  status: string;
  waiting: {
    id: string;
    position: number | null;
    cls: string;
    number: number;
  }[];
}

export interface SimState {
  runId: string;
  startedAt: number;
  businesses: SimBusiness[];
  queues: Map<string, SimQueue>;
  tokens: Map<string, SimToken>;
  events: Map<string, QueueEvent[]>;
  probes: ProbeResult[];
  consoleSnapshots: ConsoleSnapshot[];
  /** Join coordinates, kept in memory only for the log scan (never written out). */
  coordinates: { lat: number; lng: number }[];
  unexpected: {
    endpoint: string;
    status: number;
    code: string | null;
    /** Why status is 0 (see `ApiResult.error`). */
    error?: string | null;
  }[];
  /** Joins whose first answer was lost and that a retry recovered (F2). */
  joinRetries: { recovered: number; viaAlreadyInQueue: number };
  joinsOk: Map<string, number>;
  triageOk: Map<string, number>;
  pausedRejections: number;
  fullRejections: number;
  mapPolls: number;
}

export function newState(runId: string): SimState {
  return {
    runId,
    startedAt: Date.now(),
    businesses: [],
    queues: new Map(),
    tokens: new Map(),
    events: new Map(),
    probes: [],
    consoleSnapshots: [],
    coordinates: [],
    unexpected: [],
    joinRetries: { recovered: 0, viaAlreadyInQueue: 0 },
    joinsOk: new Map(),
    triageOk: new Map(),
    pausedRejections: 0,
    fullRejections: 0,
    mapPolls: 0,
  };
}

export function logEvent(state: SimState, queueId: string, e: QueueEvent) {
  let list = state.events.get(queueId);
  if (!list) {
    list = [];
    state.events.set(queueId, list);
  }
  list.push(e);
}

export const TERMINAL_STATES = new Set([
  "SERVED",
  "EXPIRED",
  "LEFT",
  "CANCELLED",
]);
export const ACTIVE_STATES = new Set(["WAITING", "CALLED", "GRACE"]);
