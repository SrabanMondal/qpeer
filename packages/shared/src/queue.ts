import { z } from "zod";
import { QueuePriorityInfo } from "./queue-settings";

/**
 * Token states (architecture doc §9.3). Step 4 (2026-10-18) adds BOOKED (a
 * paid Priority Pass, not yet in the line) and MISSED (grace ended; one
 * "I'm here" rejoin allowed). Active = BOOKED, WAITING, CALLED, GRACE,
 * MISSED. BOOKED and MISSED are not in the live order and not counted as
 * waiting.
 */
export const TokenState = z.enum([
  "BOOKED",
  "WAITING",
  "CALLED",
  "GRACE",
  "MISSED",
  "SERVED",
  "EXPIRED",
  "LEFT",
  "CANCELLED",
]);
export type TokenState = z.infer<typeof TokenState>;

export const ACTIVE_TOKEN_STATES = [
  "BOOKED",
  "WAITING",
  "CALLED",
  "GRACE",
  "MISSED",
] as const;

/** In the live order or at a counter (what a session's close ends or carries). */
export const LIVE_TOKEN_STATES = ["WAITING", "CALLED", "GRACE"] as const;

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

/**
 * Alert kinds (ALR-03). `refund_issued` and `missed` (ALR-08: "You missed
 * your turn. Tap I'm here when you arrive.") are sent from Step 4.
 */
export const AlertKind = z.enum([
  "head_back",
  "next",
  "called",
  "grace_started",
  "refund_issued",
  "queue_paused",
  "queue_closed",
  "missed",
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

/**
 * The walk-in GPS check without joining: `POST /v1/tokens/:id/rejoin`
 * ("I'm here" after MISSED, QUE-23) and `POST /v1/tokens/:id/checkin`
 * (Priority Pass on arrival, PRI-03). Same rules as a join: mocked → 422
 * `mock_location`, accuracy > 1000 m → 422 `no_location_fix`, outside the
 * join radius → 422 `too_far`. Never stored or logged.
 */
export const LocationCheckBody = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    accuracyM: z.number().finite().min(0).max(100_000),
    mocked: z.boolean(),
  })
  .strict();
export type LocationCheckBody = z.infer<typeof LocationCheckBody>;

/**
 * Staff "Rejoin for customer" after MISSED (R2, QUE-29):
 * `POST /v1/queues/:id/rejoin-for-customer`. Either the ticket label
 * ("14", "P3") + its 4-character check code, or a scanned signed ticket QR.
 * Same once-only and position rule as "I'm here". No match → 404.
 */
export const StaffRejoinBody = z.union([
  z
    .object({
      /** The label as shown: `14`, `P3`, `T1`. */
      label: z
        .string()
        .trim()
        .regex(/^[PpTt]?\d{1,5}$/, "Expected a ticket number"),
      checkCode: z.string().trim().min(4).max(8),
    })
    .strict(),
  z.object({ signedTicket: z.string().min(10).max(2000) }).strict(),
]);
export type StaffRejoinBody = z.infer<typeof StaffRejoinBody>;

/** Parses a ticket label ("14", "P3", "t1") into series + number; null when malformed. */
export function parseTokenLabel(
  label: string,
): { series: "R" | "P" | "T"; number: number } | null {
  const m = /^([PpTt]?)(\d{1,5})$/.exec(label.trim());
  if (!m) return null;
  const series = (m[1].toUpperCase() || "R") as "R" | "P" | "T";
  return { series, number: Number(m[2]) };
}

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
  // ----- Step 4 (2026-10-18). Optional so older builds still parse. -----
  /**
   * R2: 4-character check code shown under the number ("#14 · K7P2"). Staff
   * need number + code to rejoin a customer whose phone died.
   */
  checkCode: z.string().nullable().optional(),
  /**
   * The lane the ticket is called from: `priority` for checked-in passes and
   * upgraded tickets (an upgrade keeps its number, e.g. `14`; passes get P1,
   * P2…), else its class.
   */
  lane: TokenClass.optional(),
  /**
   * People ahead, high end (C3). Equal to `peopleAhead` except for regulars
   * while the priority lane is on: then `peopleAhead` is the low end (only
   * holders already checked in) and this assumes every N-th call is priority.
   * The ETA range (`etaLowMs`–`etaHighMs`) covers both ends.
   */
  peopleAheadHigh: z.number().int().optional(),
  /** GRACE: end of the "Come now — m:ss left" countdown (= `graceUntil`, TOK-09). */
  graceEndsAt: z.number().int().nullable().optional(),
  /** MISSED: when grace ended (QUE-22). */
  missedAt: z.number().int().nullable().optional(),
  /** MISSED and the one "I'm here" rejoin is still unused (TOK-08). */
  rejoinAvailable: z.boolean().optional(),
  /**
   * MISSED: "I'm here" before this time → behind ~`rejoinDelayMin` of
   * service; after it → the end of the line (R1). Null = no limit (or not MISSED).
   */
  rejoinUntil: z.number().int().nullable().optional(),
  /** True once the ticket used its rejoin (a second miss expires it). */
  rejoined: z.boolean().optional(),
  /** Priority Pass: check-in (or upgrade) time; null before check-in. */
  checkedInAt: z.number().int().nullable().optional(),
  /** BOOKED: the pass must be checked in before this time (PRI-03). */
  validUntil: z.number().int().nullable().optional(),
  /** "Priority lane on · 1 in N" on the ticket (PRI-07). */
  priority: QueuePriorityInfo.optional(),
  /**
   * "Skip ahead for ₹X, about N min faster" (PRI-05, C2). Set for WAITING
   * regular tickets while the lane is on; `show` is false when the saving is
   * below the business threshold (never "save ~0 min") or passes are sold out.
   */
  upgrade: z
    .object({
      pricePaise: z.number().int(),
      savingMin: z.number().int(),
      show: z.boolean(),
    })
    .nullable()
    .optional(),
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
  /** R2 check code (Step 4). */
  checkCode: z.string().nullable().optional(),
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
  /**
   * Step 4: the priority lane. With the lane on, `waitLowMs`/`waitHighMs`
   * above are the regular range (C3: low counts only holders already checked
   * in, high assumes every N-th call is priority); `waitLowMs`/`waitHighMs`
   * here are for a pass holder checking in now. Absent from D1 snapshots.
   */
  priority: z
    .object({
      enabled: z.boolean(),
      perRegular: z.number().int(),
      /** Checked-in / upgraded tokens waiting in the priority lane. */
      waiting: z.number().int(),
      waitLowMs: z.number().int().nullable(),
      waitHighMs: z.number().int().nullable(),
      /** Daily sales cap reached ("Sold out"). */
      soldOut: z.boolean(),
    })
    .optional(),
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
  // ----- Step 4 -----
  /** R2 check code (staff compare it with what the customer says). */
  checkCode: z.string().nullable().optional(),
  /** Lane the token is called from (priority for passes and upgrades). */
  lane: TokenClass.optional(),
  missedAt: z.number().int().nullable().optional(),
  /** The one rejoin after MISSED was used. */
  rejoined: z.boolean().optional(),
  checkedInAt: z.number().int().nullable().optional(),
  /**
   * C4 (2026-10-18): the holder's full name, only on `GET
   * /v1/queues/:id/console` (staff, online); never on socket messages.
   */
  holderName: z.string().nullable().optional(),
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
  /**
   * Waiting tokens in predicted call order (triage, then the priority and
   * regular lanes merged by the credit rule); `position` is 1-based in it.
   */
  waiting: z.array(ConsoleToken),
  grace: z.array(ConsoleToken),
  /** Step 4: MISSED tokens (out of the order; "Rejoin for customer"). */
  missed: z.array(ConsoleToken).optional(),
  counts: z.object({
    waiting: z.number().int(),
    inService: z.number().int(),
    grace: z.number().int(),
    /** All active tokens: waiting + in service + grace. */
    total: z.number().int(),
    /** Step 4: MISSED tokens (not in `total`). */
    missed: z.number().int().optional(),
    /** Step 4: paid passes not yet checked in (BOOKED; not in `total`). */
    booked: z.number().int().optional(),
  }),
  /**
   * Step 4 priority lane: N, the credit counter (a priority call is due when
   * `credits ≥ perRegular`) and today's sales against the cap.
   */
  priority: z
    .object({
      enabled: z.boolean(),
      perRegular: z.number().int(),
      credits: z.number().int(),
      soldToday: z.number().int(),
      dailyCap: z.number().int().nullable(),
    })
    .optional(),
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

/**
 * POST /v1/tokens/:id/cancel. `refund`: a refund was started (always false
 * for free tokens). Remote reservation: full refund when cancelled at least
 * `cancelWindowMin` before the estimated call. BOOKED pass: `refundPct` =
 * the business's cancel refund % (default 50). After check-in / an upgrade,
 * cancelling = leaving without a refund.
 */
export const CancelResponse = z.object({
  token: TokenView,
  refund: z.boolean(),
  /** Share of the fee refunded, 0–100 (Step 4). */
  refundPct: z.number().int().optional(),
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
