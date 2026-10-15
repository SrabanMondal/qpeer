import { z } from "zod";

/** Token states (architecture doc §9.3). Active = WAITING, CALLED, GRACE. */
export const TokenState = z.enum([
  "WAITING",
  "CALLED",
  "GRACE",
  "SERVED",
  "EXPIRED",
  "LEFT",
  "CANCELLED",
]);
export type TokenState = z.infer<typeof TokenState>;

export const ACTIVE_TOKEN_STATES = ["WAITING", "CALLED", "GRACE"] as const;

export function isActiveState(s: TokenState): boolean {
  return (ACTIVE_TOKEN_STATES as readonly string[]).includes(s);
}

/** R = regular, P = priority, T = triage. Numbers are unique per series per session. */
export const TokenSeries = z.enum(["R", "P", "T"]);
export type TokenSeries = z.infer<typeof TokenSeries>;

export const TokenClass = z.enum(["triage", "priority", "regular"]);
export type TokenClass = z.infer<typeof TokenClass>;

export const JoinMethod = z.enum(["walkin", "remote", "staff"]);
export type JoinMethod = z.infer<typeof JoinMethod>;

export const EndReason = z.enum([
  "served",
  "no_show",
  "left",
  "cancelled",
  "closed",
]);
export type EndReason = z.infer<typeof EndReason>;

/** Live status of a queue's current session. */
export const LiveStatus = z.enum(["closed", "open", "paused"]);
export type LiveStatus = z.infer<typeof LiveStatus>;

/** Alert kinds (ALR-03). `refund_issued` is sent from Step 4. */
export const AlertKind = z.enum([
  "head_back",
  "next",
  "called",
  "grace_started",
  "refund_issued",
  "queue_paused",
  "queue_closed",
]);
export type AlertKind = z.infer<typeof AlertKind>;

/** Android notification channel the app creates (ALR-06). */
export const PUSH_CHANNEL_ID = "queue-alerts";

/** Display label of a token number: regular `47`, priority `P3`, triage `T1`. */
export function tokenLabel(series: TokenSeries, number: number): string {
  return series === "R" ? String(number) : `${series}${number}`;
}

// ---------- requests ----------

/**
 * POST /v1/queues/:id/join (JON-04). The location is only used for the
 * distance check and is never stored or logged.
 */
export const JoinBody = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    /** Reported horizontal accuracy in metres. */
    accuracyM: z.number().finite().min(0).max(100_000),
    /** True when the OS reports a mock location provider. */
    mocked: z.boolean(),
  })
  .strict();
export type JoinBody = z.infer<typeof JoinBody>;

/** POST /v1/queues/:id/next. Counter defaults to 1. */
export const NextBody = z
  .object({ counter: z.number().int().min(1).max(20).optional() })
  .strict();
export type NextBody = z.infer<typeof NextBody>;

export const MyTokensQuery = z
  .object({ status: z.enum(["active", "recent"]).default("active") })
  .strict();
export type MyTokensQuery = z.infer<typeof MyTokensQuery>;

export const DevicePlatform = z.enum(["android", "ios"]);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

export const ExpoPushToken = z
  .string()
  .regex(
    /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/,
    "Expected an Expo push token",
  );

/** POST /v1/me/devices (ALR-02): upsert by push token. */
export const DeviceBody = z
  .object({ expoPushToken: ExpoPushToken, platform: DevicePlatform })
  .strict();
export type DeviceBody = z.infer<typeof DeviceBody>;

// ---------- responses ----------

/**
 * A customer's live token (TOK-01). Times are epoch ms. ETA fields are only set
 * while WAITING. `leaveHomeByMs` is always null from the server (it needs the
 * phone's distance; the app computes it with `leaveHomeBy()` from `eta.ts`).
 */
export const TokenView = z.object({
  id: z.string(),
  queueId: z.string(),
  businessId: z.string(),
  businessName: z.string(),
  queueName: z.string(),
  number: z.number().int(),
  series: TokenSeries,
  /** Display label, e.g. `47` or `T2`. */
  label: z.string(),
  method: JoinMethod,
  state: TokenState,
  /** Live status of the queue (shows "paused" to waiting users, TOK-04). */
  queueStatus: LiveStatus,
  peopleAhead: z.number().int(),
  /** Label of the token called most recently, or null. */
  nowServing: z.string().nullable(),
  etaLowMs: z.number().int().nullable(),
  etaHighMs: z.number().int().nullable(),
  beBackByMs: z.number().int().nullable(),
  leaveHomeByMs: z.number().int().nullable(),
  counter: z.number().int().nullable(),
  joinedAt: z.number().int(),
  calledAt: z.number().int().nullable(),
  graceUntil: z.number().int().nullable(),
  endedAt: z.number().int().nullable(),
  endReason: EndReason.nullable(),
  /** True for paid tokens (Step 4). */
  paid: z.boolean(),
});
export type TokenView = z.infer<typeof TokenView>;

/** One row of GET /v1/me/tokens (TOK-06), from the durable D1 record. */
export const TokenSummary = z.object({
  id: z.string(),
  queueId: z.string(),
  businessId: z.string(),
  businessName: z.string(),
  queueName: z.string(),
  number: z.number().int(),
  series: TokenSeries,
  label: z.string(),
  method: JoinMethod,
  state: TokenState,
  joinedAt: z.number().int(),
  calledAt: z.number().int().nullable(),
  endedAt: z.number().int().nullable(),
  endReason: EndReason.nullable(),
});
export type TokenSummary = z.infer<typeof TokenSummary>;

export const MyTokensResponse = z.object({ items: z.array(TokenSummary) });
export type MyTokensResponse = z.infer<typeof MyTokensResponse>;

/**
 * Live summary of a queue (JON-03, map snapshot). Wait range is a duration for
 * a new joiner, from `updatedAt`; null while closed.
 */
export const QueueLiveSummary = z.object({
  status: LiveStatus,
  nowServing: z.string().nullable(),
  waiting: z.number().int(),
  waitLowMs: z.number().int().nullable(),
  waitHighMs: z.number().int().nullable(),
  updatedAt: z.number().int(),
});
export type QueueLiveSummary = z.infer<typeof QueueLiveSummary>;

/** A token as the staff console sees it (no customer identity). */
export const ConsoleToken = z.object({
  id: z.string(),
  number: z.number().int(),
  series: TokenSeries,
  label: z.string(),
  cls: TokenClass,
  method: JoinMethod,
  state: TokenState,
  /** 1-based place in the waiting list; null unless WAITING. */
  position: z.number().int().nullable(),
  joinedAt: z.number().int(),
  calledAt: z.number().int().nullable(),
  counter: z.number().int().nullable(),
  graceUntil: z.number().int().nullable(),
  paid: z.boolean(),
});
export type ConsoleToken = z.infer<typeof ConsoleToken>;

/** GET /v1/queues/:id/console and every console action's response. */
export const ConsoleState = z.object({
  queueId: z.string(),
  sessionId: z.string().nullable(),
  status: LiveStatus,
  nowServing: z.string().nullable(),
  counters: z.number().int(),
  /** CALLED tokens (one per counter at most, normally). */
  serving: z.array(ConsoleToken),
  waiting: z.array(ConsoleToken),
  grace: z.array(ConsoleToken),
  counts: z.object({
    waiting: z.number().int(),
    inService: z.number().int(),
    grace: z.number().int(),
    /** All active tokens: waiting + in service + grace. */
    total: z.number().int(),
  }),
  eta: z.object({
    meanIntervalMs: z.number(),
    sigmaMs: z.number(),
    intervals: z.number().int(),
    coldStart: z.boolean(),
    /** Wait range for someone joining now (duration). */
    waitLowMs: z.number().int().nullable(),
    waitHighMs: z.number().int().nullable(),
  }),
  /** Undo of the last Next is possible until this time (QUE-12). */
  undoUntil: z.number().int().nullable(),
  triageLeftToday: z.number().int(),
  updatedAt: z.number().int(),
});
export type ConsoleState = z.infer<typeof ConsoleState>;

/** POST /v1/queues/:id/triage (QUE-11). */
export const TriageResponse = z.object({
  token: TokenView,
  console: ConsoleState,
});
export type TriageResponse = z.infer<typeof TriageResponse>;

/** POST /v1/tokens/:id/cancel. `refund` is decided in Step 4 (always false for free tokens). */
export const CancelResponse = z.object({
  token: TokenView,
  refund: z.boolean(),
});
export type CancelResponse = z.infer<typeof CancelResponse>;

export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;

/**
 * WebSocket messages, server → client (`GET /v1/queues/:id/live`).
 * Heartbeat: the client sends the text `{"type":"ping"}` every 30 s and gets
 * `{"type":"pong"}` back (Hibernation auto-response; the DO doesn't wake up).
 */
export const LiveMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("token"), token: TokenView }),
  z.object({ type: z.literal("queue"), console: ConsoleState }),
  z.object({ type: z.literal("pong") }),
]);
export type LiveMessage = z.infer<typeof LiveMessage>;

export const LIVE_PING = '{"type":"ping"}';
export const LIVE_PONG = '{"type":"pong"}';
