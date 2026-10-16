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
  /** C4: the ticket's validity (`ticketValidityMin`) ran out. */
  "validity",
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

/** A device hash: 64 lowercase hex characters (SHA-256). Never the raw id. */
export const DeviceHash = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Expected SHA-256 hex");

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
    /**
     * C2 (INC-042): SHA-256 (hex) of the phone's ANDROID_ID plus a fixed app
     * salt. Optional: older app builds don't send it.
     */
    deviceHash: DeviceHash.optional(),
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
  .object({
    expoPushToken: ExpoPushToken,
    platform: DevicePlatform,
    /** C2: same hash as on joins; optional for older builds. */
    deviceHash: DeviceHash.optional(),
  })
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
  /**
   * Version of the token itself: goes up on every change of this token
   * (state, place, call…), never down. Views of the same token can reach a
   * client out of order (a socket message sent before a leave can arrive
   * after the leave's HTTP answer), so clients keep the highest `rev`
   * (`newerTokenView`). Changes elsewhere in the queue (people ahead, ETA)
   * keep the rev.
   */
  rev: z.number().int(),
  // Fields added in the fix batch: optional so an app build and a server
  // build of different ages still parse each other's answers.
  /** Queue session the number belongs to (signed ticket, C3). */
  sessionId: z.string().optional(),
  cls: TokenClass.optional(),
  /** C4: end of the ticket's validity; null = until the queue closes. */
  expiresAt: z.number().int().nullable().optional(),
  /** C4: still valid when the queue closed; kept at the front of the next session. */
  carriedOver: z.boolean().optional(),
  /**
   * C3: compact Ed25519-signed ticket (`ticket.ts`), set on HTTP answers for
   * active tokens when the server has a signing key; never on socket messages.
   */
  signedTicket: z.string().nullable().optional(),
});
export type TokenView = z.infer<typeof TokenView>;

/**
 * Which of two views of the same token to show: the incoming one unless the
 * current one is newer (higher `rev`). Equal revs take the incoming view (same
 * token state, fresher queue position/ETA). Step 3.5 H1: a customer who left
 * briefly saw WAITING again from a late socket message.
 */
export function newerTokenView(
  current: TokenView | undefined | null,
  incoming: TokenView,
): TokenView {
  if (current && current.id === incoming.id && current.rev > incoming.rev) {
    return current;
  }
  // Socket views carry no signed ticket: keep the one we already have.
  if (
    current &&
    current.id === incoming.id &&
    incoming.signedTicket == null &&
    current.signedTicket
  ) {
    return { ...incoming, signedTicket: current.signedTicket };
  }
  return incoming;
}

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
  /** C4: end of validity; null = until the queue closes. */
  expiresAt: z.number().int().nullable().optional(),
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
  /** Tokens at a counter now (CALLED). B19: "Next in ~N min" vs "No wait". */
  inService: z.number().int().optional(),
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
  /** C4: carried over from an earlier session (keeps its number). */
  carriedOver: z.boolean().optional(),
  expiresAt: z.number().int().nullable().optional(),
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
  /**
   * B20: when the open session closes by itself (30 min after the day's last
   * hours range, or later after "Keep open"); null while closed or when the
   * hours are not known yet. The console warns 15 min before.
   */
  autoCloseAt: z.number().int().nullable().optional(),
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
