import { DurableObject } from "cloudflare:workers";
import {
  type AlertKind,
  autoCloseAt,
  type ConsoleState,
  type ConsoleToken,
  callOrder,
  capInterval,
  creditsAfterCall,
  type EndReason,
  ETA_INTERVAL_WINDOW,
  etaHit,
  ewmaUpdate,
  isOpenAt,
  istDayStart,
  type JoinMethod,
  KEEP_OPEN_STEP_MS,
  type LaneState,
  type LiveStatus,
  lateWindowEndsAt,
  makeCheckCode,
  newPriorityPeopleAhead,
  newRegularPeopleAhead,
  nextLane,
  type PeopleAheadRange,
  type PriorityPreview,
  priorityInfo,
  priorityPeopleAhead,
  type QueueLiveSummary,
  type QueueSettings,
  regularPeopleAhead,
  savingMinutes,
  showSaving,
  type TokenClass,
  type TokenSeries,
  type TokenView,
  tokenLabel,
  type WeeklyHours,
  withinLateWindow,
} from "@qpeer/shared";
import { pushTransport } from "../modules/notifications/expo-push";
import {
  type EtaContext,
  estimateFor,
  etaContext,
  pausedTotalNow,
} from "./eta";
import {
  allocateSortKey,
  currentRejoinK,
  LANE_BY_RANK,
  laneOf,
  placeBehind,
  rankOf,
} from "./ordering";
import {
  type AnalyticsPayload,
  applyOutboxItem,
  applyOutboxPushes,
  applyOutboxRows,
  type PaymentPayload,
  type SnapshotPayload,
  type TokenUpsertPayload,
} from "./outbox";
import {
  ALERT_BITS,
  alertText,
  CONSOLE_TAG,
  encode,
  HEAD_BACK_LEAD_MS,
  HEAD_BACK_MIN_AGE_MS,
  LIVE_PING,
  LIVE_PONG,
  NEAR_POSITIONS,
  type SocketAttachment,
  tokenTag,
} from "./protocol";
import {
  type DueTimes,
  earliestDue,
  FAR_FANOUT_INTERVAL_MS,
  HOUR_MS,
  istDay,
  istHourStart,
  OUTBOX_BACKOFF_MS,
  outboxBackoff,
  SNAPSHOT_MIN_INTERVAL_MS,
} from "./scheduler";
import {
  HOURLY_FIELDS,
  type HourlyCounts,
  type HourlyRow,
  type Meta,
  type OutboxKind,
  type OutboxRow,
  QueueStore,
  RANK_SPAN,
  type TokenRow,
  type UndoRecord,
} from "./storage";

/** Error codes the DO can return (mapped to HTTP by the Worker, §7). */
export type DoErrorCode =
  | "not_found"
  | "invalid_state"
  | "queue_closed"
  | "queue_paused"
  | "queue_full"
  | "already_in_queue"
  | "device_in_queue"
  | "quota_full"
  | "priority_off"
  | "sold_out"
  | "conflict";

/** RPC results are values, not thrown errors (custom errors don't survive RPC). */
export type DoResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: DoErrorCode;
      message: string;
      details?: Record<string, string | number>;
    };

const ok = <T>(value: T): DoResult<T> => ({ ok: true, value });
const fail = <T = never>(
  code: DoErrorCode,
  message: string,
  details?: Record<string, string | number>,
): DoResult<T> => ({ ok: false, code, message, details });

export interface InitInput {
  queueId: string;
  businessId: string;
  settings: QueueSettings;
  settingsVersion: number;
  queueName: string;
  businessName: string;
}

export interface AllocateInput {
  method: JoinMethod;
  /** Null only for staff-inserted triage tokens. */
  userId: string | null;
  cls: TokenClass;
  /** Paid allocations (Step 4): idempotent by this id. */
  paymentOrderId?: string;
  /** D1 `payments.id` of that payment (Step 4). */
  paymentId?: string;
  /** C2: hash of the phone's ANDROID_ID (free walk-ins); absent on old builds. */
  deviceHash?: string | null;
}

/** A Priority Pass after a confirmed payment (Step 4, `confirmPayment` only). */
export interface BookInput {
  userId: string;
  paymentOrderId: string;
  paymentId: string;
  deviceHash: string | null;
}

/** "Skip ahead" after a confirmed payment (Step 4, `confirmPayment` only). */
export interface UpgradeInput {
  tokenId: string;
  paymentOrderId: string;
  paymentId: string;
}

/** What the Worker checks before creating a Razorpay order (Step 4). */
export interface PurchaseCheck {
  kind: "reservation" | "priority" | "upgrade";
  userId: string;
  /** The token to upgrade (upgrade only). */
  tokenId?: string;
}

export interface PurchaseInfo {
  pricePaise: number;
  settings: QueueSettings;
  /** Upgrade only: the estimated saving now (C2). */
  savingMin: number | null;
}

/** How a staff "Rejoin for customer" names the ticket (R2). */
export type StaffRejoinRef =
  | { tokenId: string }
  | { series: TokenSeries; number: number; checkCode: string };

/** A paid token's money outcome decided by the DO (applied via the outbox). */
export interface PaidOutcome {
  tokenId: string;
  orderId: string;
  action: "refund" | "forfeit";
}

export interface TokenWithOwner {
  token: TokenView;
  userId: string | null;
}

/** Load-test audit view of one DO (see `auditTokens`). */
export interface AuditDump {
  queueId: string | null;
  sessionId: string | null;
  status: "closed" | "open" | "paused";
  waiting: number;
  pendingOutbox: number;
  tokens: {
    id: string;
    sessionId: string;
    number: number;
    series: TokenSeries;
    cls: TokenClass;
    method: JoinMethod;
    userId: string | null;
    state: TokenRow["state"];
    sortKey: number;
    joinedAt: number;
    calledAt: number | null;
    servedAt: number | null;
    endedAt: number | null;
    endReason: EndReason | null;
    rev: number;
    peopleAhead: number | null;
    /** Step 4: high end of people ahead (C3); equal to `peopleAhead` unless a ranged regular. */
    peopleAheadHigh?: number | null;
    lane?: TokenClass;
    checkCode?: string | null;
    missedAt?: number | null;
    rejoined?: boolean;
    checkedInAt?: number | null;
  }[];
  /** Step 4: credit counter and N (load-test fairness checks). */
  priority?: { enabled: boolean; perRegular: number; credits: number };
}

/** Undo of the last Next is allowed this long (QUE-12). */
export const UNDO_WINDOW_MS = 30_000;
/** Minimum delay before an alarm fires, so "due now" can't spin. */
const MIN_ALARM_DELAY_MS = 250;
/** Safety-net alarm for outbox items an inline drain is about to apply. */
const OUTBOX_INLINE_SAFETY_MS = OUTBOX_BACKOFF_MS[0];
/** RPCs and drains slower than this log their phase timings. */
const SLOW_RPC_MS = 1_000;
/** A D1 row batch that takes longer is treated as failed (retried later). */
const ROW_BATCH_TIMEOUT_MS = 8_000;
/** Longest a mutating RPC waits for its D1 rows before answering anyway. */
const ROWS_WAIT_MS = 5_000;
// Payment decisions (refund due / forfeit) are plain D1 updates: they go with
// the rows, so the caller's Worker can process a refund right after the RPC.
const ROW_KINDS: OutboxKind[] = ["token_upsert", "snapshot", "payment"];
const SIDE_KINDS: OutboxKind[] = ["push", "analytics", "strike"];

/** Rejects after `ms`; the underlying call keeps running (callers are idempotent). */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
/** How many waiting tokens are checked for head-back alerts. */
const HEAD_BACK_SCAN = 50;

const SERIES: Record<TokenClass, TokenSeries> = {
  regular: "R",
  priority: "P",
  triage: "T",
};

/** Side effects collected during one mutation. */
interface Fx {
  changed: boolean;
  touched: Set<string>;
  snapshotNow: boolean;
  allocatedId: string | null;
}

const newFx = (): Fx => ({
  changed: false,
  touched: new Set(),
  snapshotNow: false,
  allocatedId: null,
});

/** Alerts that fire again after a ticket is sent back (skip, rejoin). */
const RESEND_BITS = ALERT_BITS.called | ALERT_BITS.next | ALERT_BITS.head_back;

const DAY_MS = 24 * HOUR_MS;

/** Inputs every token view of one call shares (counted once). */
interface ViewCtx {
  eta: EtaContext;
  lanes: LaneState;
  settings: QueueSettings;
  status: LiveStatus;
  soldOut: boolean;
}

/**
 * One Durable Object per queue (architecture doc §9): the single writer of the
 * queue's live state. All mutating RPCs run their state change synchronously in
 * one storage transaction (so they never interleave), then broadcast to
 * sockets, reschedule the alarm and drain the outbox.
 *
 * Permissions are checked by the Worker before calling; the DO trusts its caller.
 */
export class QueueDO extends DurableObject<Env> {
  private readonly store: QueueStore;
  private rowChain: Promise<void> = Promise.resolve();
  private sideChain: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new QueueStore(ctx.storage.sql);
    this.store.migrate();
    // Heartbeat answered by the runtime without waking the object (§9.9).
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG),
    );
  }

  /** Injectable clock: real time plus a test-only offset kept in storage. */
  private now(): number {
    return Date.now() + this.store.get("clock_offset_ms");
  }

  // =====================================================================
  // RPC: configuration
  // =====================================================================

  /** Stores identity, labels and settings. Idempotent; older settings are ignored. */
  async init(input: InitInput): Promise<void> {
    await this.mutate("init", (_now, fx) => {
      const s = this.store;
      if (s.get("queue_id") === null) {
        s.set("queue_id", input.queueId);
        s.set("business_id", input.businessId);
        fx.changed = true;
        fx.snapshotNow = true;
      }
      const labels = {
        queueName: input.queueName,
        businessName: input.businessName,
      };
      if (JSON.stringify(labels) !== JSON.stringify(s.get("labels"))) {
        s.set("labels", labels);
      }
      this.applySettings(input.settings, input.settingsVersion, fx);
      return ok(null);
    });
  }

  /** New settings for new tokens (§8). Ignores versions not newer than the current one. */
  async updateSettings(
    settings: QueueSettings,
    version: number,
  ): Promise<{ applied: boolean }> {
    const r = await this.mutate("updateSettings", (_now, fx) =>
      ok(this.applySettings(settings, version, fx)),
    );
    return { applied: r.ok && r.value };
  }

  /** Names used in token views and push texts. */
  async setLabels(labels: {
    queueName?: string;
    businessName?: string;
  }): Promise<void> {
    const cur = this.store.get("labels");
    this.store.set("labels", {
      queueName: labels.queueName ?? cur.queueName,
      businessName: labels.businessName ?? cur.businessName,
    });
  }

  private applySettings(
    settings: QueueSettings,
    version: number,
    fx: Fx,
  ): boolean {
    if (version <= this.store.get("settings_version")) return false;
    this.store.set("settings", settings);
    this.store.set("settings_version", version);
    fx.changed = true;
    return true;
  }

  // =====================================================================
  // RPC: session (open / close / pause / resume)
  // =====================================================================

  /** BIZ-13: starts a session (numbers restart at 1). Idempotent while open. */
  async open(): Promise<DoResult<ConsoleState>> {
    return this.mutate(
      "open",
      (now, fx) => {
        const s = this.store;
        if (s.get("queue_id") === null) {
          return fail("invalid_state", "Queue is not initialised");
        }
        if (s.get("status") !== "closed") return ok(null);
        const sessionId = crypto.randomUUID();
        s.set("status", "open");
        s.set("session_id", sessionId);
        s.set("opened_at", now);
        s.set("next_number", { R: 1, P: 1, T: 1 });
        s.set("now_serving", null);
        s.set("last_call_at", null);
        s.set("paused_since", null);
        s.set("paused_total_ms", 0);
        s.set("paused_at_last_call", 0);
        s.set("undo", null);
        s.set("last_served", null);
        s.set("keep_open_until", null);
        // C1: the first priority holder waits N regular calls.
        s.set("priority_credits", 0);
        s.pruneOldSessions(sessionId);
        fx.changed = true;
        fx.snapshotNow = true;
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
  }

  /**
   * QUE-09: ends the session; every token in it expires (`queue_closed`
   * alert), except regular WAITING tokens whose validity (C4) runs past now:
   * they carry over to the front of the next session. Checked-in priority
   * tokens never carry over (C6) and MISSED tokens never do (R4).
   *
   * Money (Step 4, PAY-09/15, PRI-10, C6): every paid token that ends here
   * is refunded in full — except a MISSED one at a normal close, which is
   * forfeited (PAY-14: it expired and the person never came back). A close
   * while the business's hours are still running counts as "closing early":
   * MISSED fees are refunded too. `business: true` (business deactivated or
   * queue archived = the business cancels) also refunds BOOKED passes and
   * carries nothing over. Refunds/forfeits go through the outbox to D1;
   * `paidTokens` lists them for the Worker. Idempotent.
   */
  async close(opts: { business?: boolean } = {}): Promise<
    DoResult<{
      console: ConsoleState;
      paidTokens: PaidOutcome[];
    }>
  > {
    const paidTokens: PaidOutcome[] = [];
    return this.mutate(
      "close",
      (now, fx) => {
        const closed = this.store.get("status") === "closed";
        if (closed && !opts.business) return ok(null);
        paidTokens.push(
          ...(closed
            ? this.cancelBooked(now, fx)
            : this.closeCore(now, fx, opts.business ? "business" : "manual")),
        );
        return ok(null);
      },
      (now) => ({ console: this.consoleState(now), paidTokens }),
    );
  }

  /** Manual close, auto-close (B20) and the cron share this. */
  private closeCore(
    now: number,
    fx: Fx,
    mode: "manual" | "auto" | "business",
  ): PaidOutcome[] {
    const s = this.store;
    const paid: PaidOutcome[] = [];
    const hours = s.get("hours");
    const early =
      mode === "business" ||
      (mode === "manual" && hours !== null && isOpenAt(hours, now));
    for (const t of s.sessionTokens()) {
      if (
        mode !== "business" &&
        t.state === "WAITING" &&
        t.expires_at !== null &&
        t.expires_at > now &&
        rankOf(t.sort_key) !== 1
      ) {
        // C4 carry-over: keeps number, session id and place (sort key).
        if (!t.carried) this.change(t.id, { carried: 1 }, now, fx);
        // Fresh "next"/"head back" alerts in the next session.
        const fresh = s.token(t.id);
        if (fresh) {
          s.setAlertFlags(
            t.id,
            fresh.alert_flags &
              ~(
                ALERT_BITS.next |
                ALERT_BITS.head_back |
                ALERT_BITS.queue_paused
              ),
          );
        }
        continue;
      }
      this.alert(t, "queue_closed", now);
      if (t.state === "MISSED") {
        paid.push(
          ...this.endMissed(t, now, fx, early ? "refund" : "forfeit", "closed"),
        );
        continue;
      }
      this.change(t.id, endPatch("EXPIRED", "closed", now), now, fx);
      paid.push(...this.paymentAction(t, "refund", 100, "closed", now));
    }
    if (mode === "business") paid.push(...this.cancelBooked(now, fx));
    s.set("status", "closed");
    s.set("paused_since", null);
    s.set("undo", null);
    s.set("now_serving", null);
    s.set("last_served", null);
    s.set("keep_open_until", null);
    this.flushHourly(now, true);
    fx.changed = true;
    fx.snapshotNow = true;
    return paid;
  }

  /** The business cancels: BOOKED passes end with a full refund (§10.5). */
  private cancelBooked(now: number, fx: Fx): PaidOutcome[] {
    const out: PaidOutcome[] = [];
    for (const t of this.store.byState("BOOKED")) {
      this.change(t.id, endPatch("CANCELLED", "closed", now), now, fx);
      out.push(...this.paymentAction(t, "refund", 100, "business_closed", now));
    }
    return out;
  }

  /**
   * Records the money outcome of a paid token in the outbox (applied to D1
   * `payments` with the token rows; refunds are then made by the Worker).
   * `only` limits it to one of the token's orders.
   */
  private paymentAction(
    t: TokenRow,
    action: "refund" | "forfeit",
    pct: number,
    reason: string,
    now: number,
    only?: "reservation" | "upgrade",
  ): PaidOutcome[] {
    const orders: string[] = [];
    if (t.payment_order_id && only !== "upgrade")
      orders.push(t.payment_order_id);
    if (t.upgrade_order_id && only !== "reservation") {
      orders.push(t.upgrade_order_id);
    }
    const out: PaidOutcome[] = [];
    for (const orderId of orders) {
      const payload: PaymentPayload = {
        orderId,
        tokenId: t.id,
        action,
        pct,
        reason,
        at: now,
      };
      this.store.enqueue("payment", payload, now);
      out.push({ tokenId: t.id, orderId, action });
    }
    return out;
  }

  /**
   * A MISSED (or second-missed) ticket ends: EXPIRED as a no-show. Free
   * walk-ins get one strike (QUE-24); paid tickets get none (C5) and their
   * fee is forfeited — or refunded when the business closed early (PAY-15).
   */
  private endMissed(
    t: TokenRow,
    now: number,
    fx: Fx,
    money: "refund" | "forfeit",
    reason: string,
  ): PaidOutcome[] {
    this.change(t.id, endPatch("EXPIRED", "no_show", now), now, fx);
    const free = t.payment_order_id === null && t.upgrade_order_id === null;
    if (t.user_id && free && t.method === "walkin") {
      this.store.enqueue(
        "strike",
        {
          userId: t.user_id,
          tokenId: t.id,
          at: now,
          deviceHash: t.device_hash,
        },
        now,
      );
    }
    return this.paymentAction(
      t,
      money,
      money === "refund" ? 100 : 0,
      money === "refund" ? `${reason}_early` : "no_show",
      now,
    );
  }

  // =====================================================================
  // RPC: auto-close (B20, INC-047)
  // =====================================================================

  /** Business hours for the auto-close (open, hours edit, cron). */
  async setHours(hours: WeeklyHours): Promise<void> {
    if (JSON.stringify(hours) === JSON.stringify(this.store.get("hours"))) {
      return;
    }
    this.store.set("hours", hours);
    await this.reschedule();
  }

  /**
   * Console "Keep open": moves the auto-close 1 h later than it is now (or
   * than now, if it is already due). Only while open/paused with known hours.
   */
  async keepOpen(): Promise<DoResult<ConsoleState>> {
    return this.mutate(
      "keepOpen",
      (now, fx) => {
        const deadline = this.autoCloseDeadline();
        if (deadline === null) {
          return fail("invalid_state", "The queue is not open");
        }
        this.store.set(
          "keep_open_until",
          Math.max(deadline, now) + KEEP_OPEN_STEP_MS,
        );
        fx.changed = true;
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
  }

  /**
   * Cron safety net (every 15 min): stores the hours, then closes the session
   * if its auto-close time has passed (the alarm normally did it already).
   */
  async autoCloseCheck(
    hours: WeeklyHours,
  ): Promise<{ closed: boolean; autoCloseAt: number | null }> {
    await this.setHours(hours);
    const r = await this.mutate("autoClose", (now, fx) => {
      const at = this.autoCloseDeadline();
      if (at === null || at > now) return ok(false);
      this.autoClose(now, fx);
      return ok(true);
    });
    return {
      closed: r.ok && r.value,
      autoCloseAt: this.autoCloseDeadline(),
    };
  }

  /** Effective auto-close time of the open session, or null. */
  private autoCloseDeadline(): number | null {
    const s = this.store;
    if (s.get("status") === "closed") return null;
    const hours = s.get("hours");
    const openedAt = s.get("opened_at");
    if (!hours || openedAt === null) return null;
    const base = autoCloseAt(hours, openedAt);
    const keep = s.get("keep_open_until");
    return keep === null ? base : Math.max(base, keep);
  }

  /**
   * B20 auto-close. Paid tokens' refunds/forfeits are written to D1 through
   * the outbox (`payment` items); the 15-min cron makes the Razorpay
   * refunds, since the Worker isn't in this call path (Step 4).
   */
  private autoClose(now: number, fx: Fx): void {
    const paid = this.closeCore(now, fx, "auto");
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        where: "queue-do.auto-close",
        queueId: this.store.get("queue_id"),
        paidTokens: paid.length,
      }),
    );
  }

  /** QUE-07: pause (no joins, no Next; paused time is excluded from the ETA). */
  async pause(): Promise<DoResult<ConsoleState>> {
    return this.mutate(
      "pause",
      (now, fx) => {
        const s = this.store;
        const status = s.get("status");
        if (status === "closed") return fail("queue_closed", "Queue is closed");
        if (status === "paused") return ok(null);
        s.set("status", "paused");
        s.set("paused_since", now);
        for (const t of s.byState("WAITING")) {
          this.alert(t, "queue_paused", now);
        }
        fx.changed = true;
        fx.snapshotNow = true;
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
  }

  async resume(): Promise<DoResult<ConsoleState>> {
    return this.mutate(
      "resume",
      (now, fx) => {
        const s = this.store;
        const status = s.get("status");
        if (status === "closed") return fail("queue_closed", "Queue is closed");
        if (status === "open") return ok(null);
        s.set("paused_total_ms", pausedTotalNow(s, now));
        s.set("paused_since", null);
        s.set("status", "open");
        fx.changed = true;
        fx.snapshotNow = true;
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
  }

  // =====================================================================
  // RPC: joining
  // =====================================================================

  /** Join pre-check in the order of JON-05: closed, paused, full. */
  async checkJoin(): Promise<DoResult<null>> {
    const s = this.store;
    const status = s.get("status");
    if (status === "closed") return fail("queue_closed", "Queue is closed");
    if (status === "paused") return fail("queue_paused", "Queue is paused");
    if (s.countState("WAITING") >= s.get("settings").maxSize) {
      return fail("queue_full", "Queue is full");
    }
    return ok(null);
  }

  /**
   * Can a remote reservation be made right now? (used before creating an
   * order, Step 4). Open, not full, the user has no active ticket here,
   * remote quota left.
   */
  async checkQuota(userId: string): Promise<DoResult<{ available: true }>> {
    const s = this.store;
    const status = s.get("status");
    if (status === "closed") return fail("queue_closed", "Queue is closed");
    if (status === "paused") return fail("queue_paused", "Queue is paused");
    const settings = s.get("settings");
    if (s.countState("WAITING") >= settings.maxSize) {
      return fail("queue_full", "Queue is full");
    }
    // One active ticket per person per queue (owner, 2026-10-18), paid or
    // free, BOOKED and MISSED included (INC-065).
    const mine = this.activeTicketOf(userId);
    if (mine) {
      return fail("already_in_queue", "You already have a ticket here", {
        tokenId: mine.id,
      });
    }
    if (!this.remoteQuotaAvailable()) {
      return fail("quota_full", "Reservations are full right now");
    }
    return ok({ available: true });
  }

  /**
   * New token at the end of its class (§9.5). Idempotent by `paymentOrderId`
   * (QUE-21): a repeated call returns the same token with `created: false`.
   */
  async allocate(
    input: AllocateInput,
  ): Promise<DoResult<{ token: TokenView; created: boolean }>> {
    return this.mutate(
      "allocate",
      (now, fx) => this.allocateCore(input, now, fx),
      (now, v) => {
        const row = this.store.token(v.id);
        if (!row) throw new Error("allocated token missing");
        return { token: this.tokenView(row, now), created: v.created };
      },
    );
  }

  /** QUE-11: free staff-only triage token (front of the queue), daily cap. */
  async insertTriage(): Promise<
    DoResult<{ token: TokenView; console: ConsoleState }>
  > {
    return this.mutate(
      "insertTriage",
      (now, fx) => {
        const s = this.store;
        const day = istDay(now);
        const t = s.get("triage");
        const used = t.day === day ? t.count : 0;
        if (s.get("status") === "closed") {
          return fail("queue_closed", "Queue is closed");
        }
        if (used >= s.get("settings").triageDailyCap) {
          return fail("quota_full", "Triage limit reached for today", {
            cap: s.get("settings").triageDailyCap,
          });
        }
        const r = this.allocateCore(
          { method: "staff", userId: null, cls: "triage" },
          now,
          fx,
        );
        if (r.ok) s.set("triage", { day, count: used + 1 });
        return r;
      },
      (now, v) => {
        const row = this.store.token(v.id);
        if (!row) throw new Error("allocated token missing");
        return {
          token: this.tokenView(row, now),
          console: this.consoleState(now),
        };
      },
    );
  }

  private allocateCore(
    input: AllocateInput,
    now: number,
    fx: Fx,
  ): DoResult<{ id: string; created: boolean }> {
    const s = this.store;
    if (input.paymentOrderId) {
      const existing = s.tokenByPaymentOrder(input.paymentOrderId);
      if (existing) return ok({ id: existing.id, created: false });
    }
    const status = s.get("status");
    const sessionId = s.get("session_id");
    if (status === "closed" || sessionId === null) {
      return fail("queue_closed", "Queue is closed");
    }
    if (status === "paused" && input.method === "walkin") {
      return fail("queue_paused", "Queue is paused");
    }
    const settings = s.get("settings");
    if (input.cls !== "triage" && s.countState("WAITING") >= settings.maxSize) {
      return fail("queue_full", "Queue is full");
    }
    const paid = Boolean(input.paymentOrderId);
    if (input.userId) {
      const mine = s.activeForUser(input.userId);
      if (!paid) {
        // One free ticket per person; a Priority Pass (booked, checked in or
        // an upgrade) is "one active ticket" too (HLD §5.2).
        const free = mine.find(
          (t) =>
            t.method !== "staff" &&
            ((t.payment_order_id === null && t.upgrade_order_id === null) ||
              t.cls === "priority"),
        );
        if (free) {
          return fail("already_in_queue", "You already have a token here", {
            tokenId: free.id,
          });
        }
      } else {
        // A paid reservation: one active ticket per person per queue, so
        // any other active ticket (paid or free, BOOKED or MISSED too) →
        // `already_in_queue` and the payment is refunded in full (INC-065).
        // `paidPerUserCap` is retired (kept in the settings, never read).
        const other = mine.find((t) => t.method !== "staff");
        if (other) {
          return fail("already_in_queue", "You already have a ticket here", {
            tokenId: other.id,
          });
        }
      }
    }
    // C2 (INC-042): one free walk-in per phone, whatever the account (a
    // reinstall gets a new anonymous account but keeps its ANDROID_ID).
    const deviceHash =
      input.method === "walkin" && !paid ? (input.deviceHash ?? null) : null;
    if (deviceHash) {
      const onDevice = s.activeFreeWalkinsForDevice(deviceHash)[0];
      if (onDevice) {
        return fail(
          "device_in_queue",
          "This phone already has a ticket in this queue",
        );
      }
    }
    if (input.method === "remote" && !this.remoteQuotaAvailable()) {
      return fail("quota_full", "Reservations are full right now");
    }

    const series = SERIES[input.cls];
    const numbers = s.get("next_number");
    const number = numbers[series];
    s.set("next_number", { ...numbers, [series]: number + 1 });
    const vc = this.viewCtx(now);
    const ahead =
      input.cls === "triage"
        ? { low: vc.lanes.triageWaiting, high: vc.lanes.triageWaiting }
        : newRegularPeopleAhead(vc.lanes);
    const sortKey = allocateSortKey(s, input.cls);
    const est = this.estimateRange(vc, now, ahead);
    const id = crypto.randomUUID();
    s.insertToken({
      id,
      session_id: sessionId,
      number,
      series,
      cls: input.cls,
      method: input.method,
      user_id: input.userId,
      state: "WAITING",
      sort_key: sortKey,
      joined_at: now,
      called_at: null,
      counter: null,
      grace_until: null,
      served_at: null,
      ended_at: null,
      end_reason: null,
      payment_order_id: input.paymentOrderId ?? null,
      // Joining at the head: they already know they're next.
      alert_flags: ahead.low === 0 ? ALERT_BITS.next : 0,
      rev: 1,
      grace_ms: settings.graceMinutes * 60_000,
      cancel_window_ms: settings.cancelWindowMin * 60_000,
      eta_low_at_join: est.lowMs,
      eta_high_at_join: est.highMs,
      device_hash: deviceHash,
      expires_at:
        settings.ticketValidityMin > 0
          ? now + settings.ticketValidityMin * 60_000
          : null,
      carried: 0,
      check_code: makeCheckCode(),
      checked_in_at: null,
      missed_at: null,
      rejoined: 0,
      upgrade_order_id: null,
      payment_id: input.paymentId ?? null,
      cancel_refund_pct: null,
    });
    this.recordToken(id, now);
    this.bump(now, { joins: 1 });
    fx.changed = true;
    fx.touched.add(id);
    fx.allocatedId = id;
    return ok({ id, created: true });
  }

  /** The user's active ticket here (any active state; staff-made ones aside). */
  private activeTicketOf(userId: string) {
    return this.store.activeForUser(userId).find((t) => t.method !== "staff");
  }

  private remoteQuotaAvailable(): boolean {
    const settings = this.store.get("settings");
    const cap = Math.floor(
      (settings.maxSize * (100 - settings.walkinQuotaPct)) / 100,
    );
    return this.store.countWaitingRemote() < cap;
  }

  // =====================================================================
  // RPC: Priority Pass + upgrade (Step 4, decided 2026-10-18)
  // =====================================================================

  /** Passes + upgrades sold today (IST) and whether the daily cap is reached. */
  private sales(now: number): { count: number; soldOut: boolean } {
    const s = this.store;
    const day = istDayStart(now);
    const rec = s.get("priority_sales");
    const count = rec.day === day ? rec.count : 0;
    const cap = s.get("settings").priorityDailyCap;
    return { count, soldOut: cap !== null && count >= cap };
  }

  private countSale(now: number): void {
    const day = istDayStart(now);
    const { count } = this.sales(now);
    this.store.set("priority_sales", { day, count: count + 1 });
  }

  /**
   * Read-only checks before the Worker creates a Razorpay order (PAY-01,
   * PRI-02, PRI-05). Reservation: open, not full, no active ticket here
   * (→ `already_in_queue` with its id), remote quota.
   * Pass: lane on, not sold out, no active ticket here (→ `already_in_queue`
   * with its id: the app offers the upgrade instead). Upgrade: own WAITING
   * regular ticket, lane on, not sold out, saving ≥ threshold (C2).
   */
  async checkPurchase(input: PurchaseCheck): Promise<DoResult<PurchaseInfo>> {
    const s = this.store;
    const now = this.now();
    const settings = s.get("settings");
    if (input.kind === "reservation") {
      const q = await this.checkQuota(input.userId);
      if (!q.ok) return q;
      return ok({
        pricePaise: settings.reservationFeePaise,
        settings,
        savingMin: null,
      });
    }
    if (!settings.priorityEnabled) {
      return fail("priority_off", "Priority Pass is off for this queue");
    }
    if (this.sales(now).soldOut) {
      return fail("sold_out", "Priority Passes are sold out for today");
    }
    if (input.kind === "priority") {
      const mine = s
        .activeForUser(input.userId)
        .find((t) => t.method !== "staff");
      if (mine) {
        return fail("already_in_queue", "You already have a ticket here", {
          tokenId: mine.id,
        });
      }
      return ok({
        pricePaise: settings.priorityFeePaise,
        settings,
        savingMin: null,
      });
    }
    const t = input.tokenId ? s.token(input.tokenId) : null;
    if (!t || t.user_id !== input.userId) {
      return fail("not_found", "Token not found");
    }
    if (s.get("status") === "closed") {
      return fail("queue_closed", "Queue is closed");
    }
    if (!isUpgradable(t)) {
      return fail(
        "invalid_state",
        "Only a waiting regular ticket can skip ahead",
      );
    }
    const offer = this.upgradeOffer(t, this.viewCtx(now), now);
    if (!offer?.show) {
      return fail(
        "invalid_state",
        "Skipping ahead would not save enough time right now",
        { reason: "saving_below_threshold", savingMin: offer?.savingMin ?? 0 },
      );
    }
    return ok({
      pricePaise: settings.priorityFeePaise,
      settings,
      savingMin: offer.savingMin,
    });
  }

  /**
   * PRI-02: a paid Priority Pass → BOOKED (no number, no session, not in the
   * line). Only from `confirmPayment`. Idempotent by `paymentOrderId`.
   * Checks: lane on, daily cap, one active ticket per person (BOOKED counts).
   */
  async book(
    input: BookInput,
  ): Promise<DoResult<{ token: TokenView; created: boolean }>> {
    return this.mutate(
      "book",
      (now, fx) => {
        const s = this.store;
        const existing = s.tokenByPaymentOrder(input.paymentOrderId);
        if (existing) return ok({ id: existing.id, created: false });
        const settings = s.get("settings");
        if (!settings.priorityEnabled) {
          return fail("priority_off", "Priority Pass is off for this queue");
        }
        if (this.sales(now).soldOut) {
          return fail("sold_out", "Priority Passes are sold out for today");
        }
        const mine = s
          .activeForUser(input.userId)
          .find((t) => t.method !== "staff");
        if (mine) {
          return fail("already_in_queue", "You already have a ticket here", {
            tokenId: mine.id,
          });
        }
        const validUntil =
          settings.priorityValidityMin > 0
            ? now + settings.priorityValidityMin * 60_000
            : istDayStart(now) + DAY_MS - 1;
        const id = crypto.randomUUID();
        s.insertToken({
          id,
          // No session or number until check-in (§8 Step 4 data).
          session_id: "",
          number: 0,
          series: "P",
          cls: "priority",
          method: "remote",
          user_id: input.userId,
          state: "BOOKED",
          sort_key: 0,
          joined_at: now,
          called_at: null,
          counter: null,
          grace_until: null,
          served_at: null,
          ended_at: null,
          end_reason: null,
          payment_order_id: input.paymentOrderId,
          alert_flags: 0,
          rev: 1,
          grace_ms: settings.graceMinutes * 60_000,
          cancel_window_ms: settings.cancelWindowMin * 60_000,
          eta_low_at_join: null,
          eta_high_at_join: null,
          device_hash: input.deviceHash,
          expires_at: validUntil,
          carried: 0,
          check_code: makeCheckCode(),
          checked_in_at: null,
          missed_at: null,
          rejoined: 0,
          upgrade_order_id: null,
          payment_id: input.paymentId,
          cancel_refund_pct: settings.priorityCancelRefundPct,
        });
        this.countSale(now);
        this.recordToken(id, now);
        this.audit("book", now, { tokenId: id });
        fx.changed = true;
        fx.touched.add(id);
        return ok({ id, created: true });
      },
      (now, v) => ({ token: this.viewById(v.id, now), created: v.created }),
    );
  }

  /**
   * PRI-03: check-in on arrival (the Worker ran the GPS check). BOOKED →
   * WAITING at the end of the priority lane (ordered by check-in time), with
   * the session's next P number. After check-in the window no longer applies.
   * Idempotent for an already checked-in pass.
   */
  async checkIn(tokenId: string, userId: string): Promise<DoResult<TokenView>> {
    return this.mutate(
      "checkIn",
      (now, fx) => {
        const s = this.store;
        const t = s.token(tokenId);
        if (!t || t.user_id !== userId) {
          return fail("not_found", "Token not found");
        }
        if (t.series === "P" && t.checked_in_at !== null) {
          if (isActive(t)) return ok(null);
          return fail("invalid_state", `Token is already ${t.state}`);
        }
        if (t.state !== "BOOKED") {
          return fail("invalid_state", `Can't check in a ${t.state} ticket`);
        }
        const status = s.get("status");
        const sessionId = s.get("session_id");
        if (status === "closed" || sessionId === null) {
          return fail("queue_closed", "Queue is closed");
        }
        if (status === "paused") return fail("queue_paused", "Queue is paused");
        if (t.expires_at !== null && t.expires_at <= now) {
          return fail("invalid_state", "This pass is no longer valid");
        }
        const vc = this.viewCtx(now);
        const ahead = newPriorityPeopleAhead(vc.lanes);
        const est = estimateFor(vc.eta, now, ahead);
        const numbers = s.get("next_number");
        const number = numbers.P;
        s.set("next_number", { ...numbers, P: number + 1 });
        const sortKey = allocateSortKey(s, "priority");
        this.change(
          tokenId,
          {
            state: "WAITING",
            session_id: sessionId,
            number,
            sort_key: sortKey,
            checked_in_at: now,
            expires_at: null,
            eta_low_at_join: est.lowMs,
            eta_high_at_join: est.highMs,
            alert_flags: ahead === 0 ? ALERT_BITS.next : 0,
          },
          now,
          fx,
        );
        this.bump(now, { joins: 1 });
        fx.allocatedId = tokenId;
        this.audit("check_in", now, { tokenId, label: `P${number}` });
        return ok(null);
      },
      (now) => this.viewById(tokenId, now),
    );
  }

  /**
   * PRI-05: "Skip ahead" after a confirmed payment. The same WAITING regular
   * ticket moves to the end of the priority lane at the upgrade time (it
   * keeps its number). Idempotent by the upgrade order. Not WAITING any more
   * → `invalid_state` (the Worker refunds in full).
   */
  async upgrade(input: UpgradeInput): Promise<DoResult<TokenView>> {
    let id = input.tokenId;
    return this.mutate(
      "upgrade",
      (now, fx) => {
        const s = this.store;
        const done = s.tokenByUpgradeOrder(input.paymentOrderId);
        if (done) {
          id = done.id;
          return ok(null);
        }
        const t = s.token(input.tokenId);
        if (!t) return fail("not_found", "Token not found");
        if (!isUpgradable(t)) {
          return fail("invalid_state", `Can't upgrade a ${t.state} ticket`);
        }
        const settings = s.get("settings");
        if (!settings.priorityEnabled) {
          return fail("priority_off", "Priority Pass is off for this queue");
        }
        if (this.sales(now).soldOut) {
          return fail("sold_out", "Priority Passes are sold out for today");
        }
        const sortKey = allocateSortKey(s, "priority");
        this.change(
          t.id,
          {
            cls: "priority",
            sort_key: sortKey,
            checked_in_at: now,
            upgrade_order_id: input.paymentOrderId,
            payment_id: t.payment_id ?? input.paymentId,
            // Priority tickets never carry over (C6).
            expires_at: null,
            carried: 0,
          },
          now,
          fx,
        );
        this.countSale(now);
        this.audit("upgrade", now, { tokenId: t.id });
        return ok(null);
      },
      (now) => this.viewById(id, now),
    );
  }

  /** PRI-02: the honest preview before buying a pass. */
  async priorityPreview(): Promise<PriorityPreview> {
    const now = this.now();
    const vc = this.viewCtx(now);
    const settings = vc.settings;
    let priorityWait: { lowMs: number; highMs: number } | null = null;
    let regularWait: { lowMs: number; highMs: number } | null = null;
    let savingMin = 0;
    if (vc.status !== "closed") {
      const p = estimateFor(vc.eta, now, newPriorityPeopleAhead(vc.lanes));
      const r = this.estimateRange(vc, now, newRegularPeopleAhead(vc.lanes));
      priorityWait = { lowMs: p.lowMs - now, highMs: p.highMs - now };
      regularWait = { lowMs: r.lowMs - now, highMs: r.highMs - now };
      savingMin = savingMinutes(regularWait, priorityWait);
    }
    return {
      queueId: this.store.get("queue_id") ?? "",
      enabled: settings.priorityEnabled,
      feePaise: settings.priorityFeePaise,
      perRegular: settings.priorityPerRegular,
      soldOut: vc.soldOut,
      priorityWait,
      regularWait,
      savingMin,
      show:
        settings.priorityEnabled &&
        !vc.soldOut &&
        showSaving(savingMin, settings.upgradeMinSavingMin),
      at: now,
    };
  }

  // =====================================================================
  // RPC: console actions
  // =====================================================================

  /**
   * QUE-05: serve whoever is CALLED at this counter, call the next waiting
   * token, record the interval (paused time excluded) and the counter.
   */
  async next(counter = 1): Promise<DoResult<ConsoleState>> {
    return this.mutate(
      "next",
      (now, fx) => {
        const s = this.store;
        const status = s.get("status");
        if (status === "closed") return fail("queue_closed", "Queue is closed");
        if (status === "paused") return fail("queue_paused", "Queue is paused");
        if (counter > s.get("settings").counters) {
          return fail("invalid_state", "No such counter", { counter });
        }
        const hourStart = istHourStart(now);
        const prevCalled = s
          .byState("CALLED")
          .filter((t) => t.counter === counter);
        // PRI-06: triage first; else the priority head when due (credits ≥
        // N); else the regular head; else the priority head. Staff can't
        // pick a priority person by hand.
        const settings = s.get("settings");
        const credits = s.get("priority_credits");
        const heads = [0, 1, 2].map((r) => s.waitingInLane(r, 1)[0] ?? null);
        const lane = nextLane(
          {
            triage: heads[0] !== null,
            priority: heads[1] !== null,
            regular: heads[2] !== null,
          },
          credits,
          settings.priorityPerRegular,
        );
        const head = lane === null ? null : heads[LANE_BY_RANK.indexOf(lane)];
        if (!head && prevCalled.length === 0) {
          return fail("invalid_state", "Nobody is waiting");
        }

        const undo: UndoRecord = {
          at: now,
          calledId: null,
          calledPrevSortKey: null,
          served: [],
          prev: {
            ewma: s.get("ewma"),
            lastCallAt: s.get("last_call_at"),
            pausedAtLastCall: s.get("paused_at_last_call"),
            nowServing: s.get("now_serving"),
            lastServed: s.get("last_served"),
            credits,
          },
          intervalId: null,
          hourStart,
          hourlyDelta: {},
        };
        const delta: Partial<HourlyCounts> = {};
        const add = (k: keyof HourlyCounts, v: number) => {
          delta[k] = (delta[k] ?? 0) + v;
        };

        for (const t of prevCalled) {
          undo.served.push({ id: t.id, calledAt: t.called_at });
          this.change(t.id, endPatch("SERVED", "served", now), now, fx);
          add("served", 1);
        }

        if (head && lane) {
          // A pass holder's wait starts at check-in, not at purchase.
          const waitFrom = waitStart(head);
          const lastCall = s.get("last_call_at");
          if (lastCall !== null) {
            const ref = Math.max(lastCall, waitFrom);
            const pausedDuring =
              s.get("paused_total_ms") - s.get("paused_at_last_call");
            const raw = Math.max(0, now - ref - pausedDuring);
            const capped = capInterval(
              raw,
              s.recentIntervals(ETA_INTERVAL_WINDOW),
            );
            undo.intervalId = s.addInterval(capped, ETA_INTERVAL_WINDOW);
            s.set("ewma", ewmaUpdate(s.get("ewma"), capped));
            add("sum_interval_ms", capped);
            add("intervals", 1);
          }
          s.set("last_call_at", now);
          s.set("paused_at_last_call", s.get("paused_total_ms"));
          undo.calledId = head.id;
          undo.calledPrevSortKey = head.sort_key;
          const called = this.change(
            head.id,
            { state: "CALLED", called_at: now, counter },
            now,
            fx,
          );
          s.set("now_serving", tokenLabel(called.series, called.number));
          s.set(
            "priority_credits",
            creditsAfterCall(credits, lane, settings.priorityPerRegular),
          );
          // C4: a carried-over ticket's wait spans the closed hours; it would
          // skew the averages, so it is not counted as a wait or ETA sample.
          // R4: a rejoined ticket's wait sample was taken at its first call;
          // the time away is left out. An upgrade changed its predicted call.
          const sample = !head.carried && !head.rejoined;
          if (sample) add("waits", 1);
          if (sample) add("sum_wait_ms", now - waitFrom);
          if (
            sample &&
            head.upgrade_order_id === null &&
            head.eta_low_at_join !== null &&
            head.eta_high_at_join !== null
          ) {
            add("eta_total", 1);
            if (etaHit(now, head.eta_low_at_join, head.eta_high_at_join)) {
              add("eta_hits", 1);
            }
          }
          this.alert(called, "called", now);
          // PRI-11: every call is logged with its time (staff-favouritism audit).
          this.audit("call", now, {
            tokenId: head.id,
            label: tokenLabel(called.series, called.number),
            lane,
            creditsBefore: credits,
            counter,
          });
        }

        this.bump(now, delta);
        undo.hourlyDelta = delta;
        s.set("undo", undo);
        fx.changed = true;
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
  }

  /** QUE-12: undo the last Next within 30 s (staff mis-tap). */
  async undoNext(): Promise<DoResult<ConsoleState>> {
    return this.mutate(
      "undoNext",
      (now, fx) => {
        const s = this.store;
        const u = s.get("undo");
        if (!u || now - u.at > UNDO_WINDOW_MS) {
          return fail("invalid_state", "Nothing to undo");
        }
        const called = u.calledId ? s.token(u.calledId) : null;
        if (u.calledId && called?.state !== "CALLED") {
          return fail("invalid_state", "The called token has changed since");
        }
        for (const sv of u.served) {
          if (s.token(sv.id)?.state !== "SERVED") {
            return fail("invalid_state", "A served token has changed since");
          }
        }
        if (called && u.calledPrevSortKey !== null) {
          let key = u.calledPrevSortKey;
          while (s.sortKeyTaken(key)) key -= 1;
          this.change(
            called.id,
            {
              state: "WAITING",
              sort_key: key,
              called_at: null,
              counter: null,
            },
            now,
            fx,
          );
          s.setAlertFlags(called.id, called.alert_flags & ~ALERT_BITS.called);
        }
        for (const sv of u.served) {
          this.change(
            sv.id,
            {
              state: "CALLED",
              called_at: sv.calledAt,
              served_at: null,
              ended_at: null,
              end_reason: null,
            },
            now,
            fx,
          );
        }
        s.set("ewma", u.prev.ewma);
        s.set("last_call_at", u.prev.lastCallAt);
        s.set("paused_at_last_call", u.prev.pausedAtLastCall);
        s.set("now_serving", u.prev.nowServing);
        if (u.prev.lastServed !== undefined) {
          s.set("last_served", u.prev.lastServed);
        }
        // C1: Undo of Next also undoes the credit change.
        if (u.prev.credits !== undefined) {
          s.set("priority_credits", u.prev.credits);
        }
        if (u.intervalId !== null) s.removeInterval(u.intervalId);
        const negative: Partial<HourlyCounts> = {};
        for (const k of Object.keys(u.hourlyDelta) as (keyof HourlyCounts)[]) {
          negative[k] = -(u.hourlyDelta[k] ?? 0);
        }
        s.bump(u.hourStart, negative);
        s.set("undo", null);
        fx.changed = true;
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
  }

  /**
   * QUE-06 (decided 2026-10-18): the token goes behind K waiting people of
   * its own class range, K = max(1, ceil(rejoinDelayMin ÷ avgServiceMin))
   * fixed now, or to the end of its lane if fewer wait (G1 class rule).
   */
  async skip(tokenId: string): Promise<DoResult<ConsoleState>> {
    return this.mutate(
      "skip",
      (now, fx) => {
        const t = this.store.token(tokenId);
        if (!t) return fail("not_found", "Token not found");
        if (t.state !== "WAITING" && t.state !== "CALLED") {
          return fail("invalid_state", `Can't skip a ${t.state} token`);
        }
        const k = currentRejoinK(this.store);
        const key = placeBehind(this.store, tokenId, k);
        this.change(
          tokenId,
          { state: "WAITING", sort_key: key, called_at: null, counter: null },
          now,
          fx,
        );
        // Sent back: they should hear "next"/"called" again when it happens.
        const fresh = this.store.token(tokenId);
        if (fresh) {
          this.store.setAlertFlags(
            tokenId,
            fresh.alert_flags & ~(ALERT_BITS.called | ALERT_BITS.next),
          );
        }
        this.audit("skip", now, { tokenId, behind: k });
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
  }

  /**
   * QUE-23 "I'm here" after MISSED (the Worker ran the GPS check). Once per
   * ticket. Within the late window: behind K waiting people of its own class
   * (R1, QUE-27); after it: the end of its lane. Simultaneous rejoins are
   * ordered by arrival here (the DO serialises them).
   */
  async rejoin(tokenId: string, userId: string): Promise<DoResult<TokenView>> {
    return this.mutate(
      "rejoin",
      (now, fx) => {
        const t = this.store.token(tokenId);
        if (!t || t.user_id !== userId) {
          return fail("not_found", "Token not found");
        }
        const r = this.rejoinCore(t, now, fx);
        return r.ok ? ok(null) : r;
      },
      (now) => this.viewById(tokenId, now),
    );
  }

  /**
   * R2 / QUE-29 staff "Rejoin for customer" (phone dead): the ticket number +
   * check code of this session, or the token id from a verified signed QR.
   * Same once-only and position rule as "I'm here". No match → not_found.
   */
  async staffRejoin(
    ref: StaffRejoinRef,
  ): Promise<DoResult<{ token: TokenView; console: ConsoleState }>> {
    let id = "";
    return this.mutate(
      "staffRejoin",
      (now, fx) => {
        const s = this.store;
        let t: TokenRow | null = null;
        if ("tokenId" in ref) {
          t = s.token(ref.tokenId);
        } else {
          const sessionId = s.get("session_id");
          const found = sessionId
            ? s.tokenByNumber(sessionId, ref.series, ref.number)
            : null;
          t =
            found && found.check_code === ref.checkCode.toUpperCase()
              ? found
              : null;
        }
        if (!t) return fail("not_found", "No ticket matches");
        id = t.id;
        const r = this.rejoinCore(t, now, fx);
        if (r.ok) this.audit("staff_rejoin", now, { tokenId: t.id });
        return r.ok ? ok(null) : r;
      },
      (now) => ({
        token: this.viewById(id, now),
        console: this.consoleState(now),
      }),
    );
  }

  private rejoinCore(t: TokenRow, now: number, fx: Fx): DoResult<null> {
    const s = this.store;
    if (t.state !== "MISSED") {
      return fail("invalid_state", "Only a missed ticket can rejoin");
    }
    if (t.rejoined) {
      return fail("invalid_state", "This ticket already rejoined once");
    }
    if (s.get("status") === "closed") {
      return fail("queue_closed", "Queue is closed");
    }
    const settings = s.get("settings");
    const within = withinLateWindow(
      t.missed_at ?? now,
      settings.lateWindowMin,
      now,
    );
    const k = currentRejoinK(s);
    const key = placeBehind(s, t.id, k, !within);
    const row = this.change(
      t.id,
      {
        state: "WAITING",
        sort_key: key,
        rejoined: 1,
        called_at: null,
        counter: null,
        grace_until: null,
      },
      now,
      fx,
    );
    // A second No-show gets its grace alert again.
    s.setAlertFlags(
      t.id,
      row.alert_flags & ~(RESEND_BITS | ALERT_BITS.grace_started),
    );
    this.audit("rejoin", now, {
      tokenId: t.id,
      behind: within ? k : "end",
    });
    return ok(null);
  }

  /** QUE-08: called token didn't show → grace period (default 10 min). */
  async noShow(tokenId: string): Promise<DoResult<ConsoleState>> {
    return this.mutate(
      "noShow",
      (now, fx) => {
        const t = this.store.token(tokenId);
        if (!t) return fail("not_found", "Token not found");
        if (t.state !== "CALLED") {
          return fail("invalid_state", "Only a called token can be a no-show");
        }
        const row = this.change(
          tokenId,
          { state: "GRACE", grace_until: now + t.grace_ms },
          now,
          fx,
        );
        this.alert(row, "grace_started", now);
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
  }

  /** QUE-08: late arrival in grace is admitted as the one being served. */
  async admit(tokenId: string): Promise<DoResult<ConsoleState>> {
    return this.mutate(
      "admit",
      (now, fx) => {
        const t = this.store.token(tokenId);
        if (!t) return fail("not_found", "Token not found");
        if (t.state !== "GRACE") {
          return fail("invalid_state", "Only a token in grace can be admitted");
        }
        this.change(
          tokenId,
          { state: "CALLED", called_at: now, grace_until: null },
          now,
          fx,
        );
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
  }

  async served(tokenId: string): Promise<DoResult<ConsoleState>> {
    return this.mutate(
      "served",
      (now, fx) => {
        const t = this.store.token(tokenId);
        if (!t) return fail("not_found", "Token not found");
        if (t.state !== "CALLED") {
          return fail("invalid_state", "Only a called token can be served");
        }
        this.change(tokenId, endPatch("SERVED", "served", now), now, fx);
        this.bump(now, { served: 1 });
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
  }

  // =====================================================================
  // RPC: customer actions
  // =====================================================================

  /**
   * QUE-10: leave at any time (no refund). `userId` null = staff acting for
   * the customer. A BOOKED pass (not in the line yet) is cancelled instead,
   * with the business's cancel refund %.
   */
  async leave(
    tokenId: string,
    userId: string | null,
  ): Promise<DoResult<TokenView>> {
    return this.mutate(
      "leave",
      (now, fx) => {
        const t = this.store.token(tokenId);
        if (!t || (userId !== null && t.user_id !== userId)) {
          return fail("not_found", "Token not found");
        }
        if (t.state === "LEFT") return ok(null);
        if (!isActive(t)) {
          return fail("invalid_state", `Token is already ${t.state}`);
        }
        if (t.state === "BOOKED") {
          this.cancelCore(t, now, fx);
          return ok(null);
        }
        this.change(tokenId, endPatch("LEFT", "left", now), now, fx);
        this.bump(now, { leaves: 1 });
        return ok(null);
      },
      (now) => this.viewById(tokenId, now),
    );
  }

  /**
   * Cancel (TOK-05, PAY-07). Free tokens = leave. Paid tokens → CANCELLED:
   * - remote reservation, WAITING, at least `cancelWindowMin` before its
   *   estimated call (HLD §9) → full refund of the reservation fee;
   * - BOOKED pass → refund at the business's cancel % (default 50, PRI-09);
   * - after check-in or an upgrade → no refund for that fee.
   * Refunds go through the outbox (D1 `refund_due`); the Worker calls Razorpay.
   */
  async cancel(
    tokenId: string,
    userId: string | null,
  ): Promise<
    DoResult<{ token: TokenView; refund: boolean; refundPct: number }>
  > {
    let refund = false;
    let refundPct = 0;
    return this.mutate(
      "cancel",
      (now, fx) => {
        const t = this.store.token(tokenId);
        if (!t || (userId !== null && t.user_id !== userId)) {
          return fail("not_found", "Token not found");
        }
        if (!isPaid(t)) {
          if (t.state === "LEFT") return ok(null);
          if (!isActive(t)) {
            return fail("invalid_state", `Token is already ${t.state}`);
          }
          this.change(tokenId, endPatch("LEFT", "left", now), now, fx);
          this.bump(now, { leaves: 1 });
          return ok(null);
        }
        if (t.state === "CANCELLED") return ok(null);
        if (!isActive(t)) {
          return fail("invalid_state", `Token is already ${t.state}`);
        }
        const r = this.cancelCore(t, now, fx);
        refund = r.refund;
        refundPct = r.pct;
        return ok(null);
      },
      (now) => ({ token: this.viewById(tokenId, now), refund, refundPct }),
    );
  }

  /**
   * Refund share (0–100) of cancelling a paid active ticket now: BOOKED pass
   * → the business's %; WAITING reservation → 100 at least the cancel
   * window before the estimated call, else 0; anything else → 0. Null for
   * free or ended tickets. The one rule behind `cancel` and
   * `TokenView.cancelRefundPct`.
   */
  private cancelRefundPct(
    t: TokenRow,
    now: number,
    vc?: ViewCtx,
  ): number | null {
    if (!isPaid(t) || !isActive(t)) return null;
    if (t.state === "BOOKED") {
      return (
        t.cancel_refund_pct ??
        this.store.get("settings").priorityCancelRefundPct
      );
    }
    if (
      t.payment_order_id !== null &&
      t.series !== "P" &&
      t.state === "WAITING"
    ) {
      const ctx = vc ?? this.viewCtx(now);
      const est = this.estimateRange(ctx, now, this.aheadOf(t, ctx));
      return est.expectedMs - now >= t.cancel_window_ms ? 100 : 0;
    }
    return 0;
  }

  private cancelCore(
    t: TokenRow,
    now: number,
    fx: Fx,
  ): { refund: boolean; pct: number } {
    const pct = this.cancelRefundPct(t, now) ?? 0;
    if (t.state === "BOOKED") {
      this.change(t.id, endPatch("CANCELLED", "cancelled", now), now, fx);
      if (pct > 0) this.paymentAction(t, "refund", pct, "cancelled", now);
      return { refund: pct > 0, pct };
    }
    const refund = pct === 100;
    this.change(t.id, endPatch("CANCELLED", "cancelled", now), now, fx);
    this.bump(now, { cancels: 1 });
    if (refund) {
      this.paymentAction(t, "refund", 100, "cancelled", now, "reservation");
    }
    return { refund, pct: refund ? 100 : 0 };
  }

  // =====================================================================
  // RPC: reads
  // =====================================================================

  async getToken(tokenId: string): Promise<DoResult<TokenWithOwner>> {
    const row = this.store.token(tokenId);
    if (!row) return fail("not_found", "Token not found");
    return ok({ token: this.tokenView(row, this.now()), userId: row.user_id });
  }

  async getState(): Promise<ConsoleState> {
    return this.consoleState(this.now());
  }

  async getSummary(): Promise<QueueLiveSummary> {
    return this.summary(this.now());
  }

  /** Tokens in the session (WAITING/CALLED/GRACE/MISSED), for archive (BIZ-11). */
  async countActiveTokens(): Promise<number> {
    return this.store.countActive();
  }

  /**
   * C4 (2026-10-18): the console shows the holder's full name when online.
   * The DO keeps no names: it gives the Worker token id → user id for the
   * console's tokens, and the Worker adds the names from D1.
   */
  async consoleOwners(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const t of this.store.sessionTokens()) {
      if (t.user_id) out[t.id] = t.user_id;
    }
    return out;
  }

  /** Step 0 connectivity check (dev route). */
  async ping(): Promise<{ ok: true; pings: number }> {
    const pings = this.store.get("pings") + 1;
    this.store.set("pings", pings);
    return { ok: true, pings };
  }

  /**
   * Test-only clock control (`ENVIRONMENT` = local): moves this queue's clock
   * forward so tests can reach grace expiry, undo windows and ETA changes.
   */
  async testAdvanceClock(ms: number): Promise<number> {
    if (this.env.ENVIRONMENT !== "local") {
      throw new Error("testAdvanceClock is only available locally");
    }
    this.store.set("clock_offset_ms", this.store.get("clock_offset_ms") + ms);
    await this.reschedule();
    return this.now();
  }

  /** Test/debug: outbox items still pending (0 once D1 and pushes are caught up). */
  async pendingOutbox(): Promise<number> {
    return this.store.outboxCount();
  }

  /**
   * Load-test audit (Step 3.5): every token the DO holds with its durable
   * fields, plus status and outbox backlog. Read-only. Only the loadtest route
   * calls it, and that route is 404 outside `ENVIRONMENT=loadtest`.
   */
  async auditTokens(): Promise<AuditDump> {
    const s = this.store;
    const now = this.now();
    const vc = this.viewCtx(now);
    const settings = s.get("settings");
    return {
      queueId: s.get("queue_id"),
      sessionId: s.get("session_id"),
      status: s.get("status"),
      waiting: s.countState("WAITING"),
      pendingOutbox: s.outboxCount(),
      priority: {
        enabled: settings.priorityEnabled,
        perRegular: settings.priorityPerRegular,
        credits: s.get("priority_credits"),
      },
      tokens: s.allTokens().map((t) => {
        const ahead = t.state === "WAITING" ? this.aheadOf(t, vc) : null;
        return {
          id: t.id,
          sessionId: t.session_id,
          number: t.number,
          series: t.series,
          cls: t.cls,
          method: t.method,
          userId: t.user_id,
          state: t.state,
          sortKey: t.sort_key,
          joinedAt: t.joined_at,
          calledAt: t.called_at,
          servedAt: t.served_at,
          endedAt: t.ended_at,
          endReason: t.end_reason,
          rev: t.rev,
          peopleAhead: ahead?.low ?? null,
          peopleAheadHigh: ahead?.high ?? null,
          lane: t.state === "WAITING" ? laneOf(t.sort_key) : t.cls,
          checkCode: t.check_code,
          missedAt: t.missed_at,
          rejoined: t.rejoined === 1,
          checkedInAt: t.checked_in_at,
        };
      }),
    };
  }

  // =====================================================================
  // WebSocket (Hibernation API, §9.9)
  // =====================================================================

  /**
   * Upgrade forwarded by the Worker after it authorised the caller:
   * `?tokenId=<id>` (customer) or `?console=1` (staff).
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const url = new URL(request.url);
    const now = this.now();
    const isConsole = url.searchParams.get("console") === "1";
    const tokenId = url.searchParams.get("tokenId");
    let first: string;
    let attachment: SocketAttachment;
    let tag: string;
    if (isConsole) {
      attachment = { kind: "console" };
      tag = CONSOLE_TAG;
      first = encode({ type: "queue", console: this.consoleState(now) });
    } else {
      const row = tokenId ? this.store.token(tokenId) : null;
      if (!row || !tokenId) return new Response("Not found", { status: 404 });
      attachment = { kind: "token", tokenId };
      tag = tokenTag(tokenId);
      first = encode({ type: "token", token: this.tokenView(row, now) });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [tag]);
    server.serializeAttachment(attachment);
    server.send(first);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(): Promise<void> {
    // Clients only send the heartbeat, which the auto-response answers.
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  // =====================================================================
  // Alarm (§9.7)
  // =====================================================================

  async alarm(): Promise<void> {
    const now = this.now();
    const fx = newFx();
    try {
      this.ctx.storage.transactionSync(() => {
        for (const t of this.store.graceDue(now)) this.expireGrace(t, now, fx);
        // C4: tickets whose validity ran out (also while the queue is closed).
        for (const t of this.store.validityDue(now))
          this.expireValidity(t, now, fx);
        // B20: auto-close once the (possibly extended) time has come.
        const closeAt = this.autoCloseDeadline();
        if (closeAt !== null && closeAt <= now) this.autoClose(now, fx);
        this.afterChange(now, fx);
      });
    } catch (e) {
      this.store.invalidate();
      throw e;
    }
    this.broadcast(now, fx);
    await this.reschedule(true);
    // The alarm owns its drain end to end (the platform retries a failed alarm).
    await this.drainOutbox();
  }

  /**
   * QUE-22: grace ran out → MISSED (out of the order, not waiting) with one
   * `missed` push (ALR-08). Each miss counts as a no-show (R4). A ticket that
   * already rejoined once misses for good: EXPIRED, + strike for a free
   * walk-in, fee forfeited for a paid one (QUE-24, C5).
   */
  private expireGrace(t: TokenRow, now: number, fx: Fx): void {
    this.bump(now, { no_shows: 1 });
    if (t.rejoined) {
      this.endMissed(t, now, fx, "forfeit", "no_show");
      return;
    }
    const row = this.change(
      t.id,
      { state: "MISSED", missed_at: now, grace_until: null, counter: null },
      now,
      fx,
    );
    this.alert(row, "missed", now);
  }

  /**
   * C4 / Step 4: validity ran out. WAITING → EXPIRED `validity` (a paid
   * reservation is refunded: it was never called). MISSED → a no-show
   * expiry (strike / forfeit). BOOKED pass never checked in → EXPIRED
   * `validity`, no refund (PRI-09).
   */
  private expireValidity(t: TokenRow, now: number, fx: Fx): void {
    if (t.state === "MISSED") {
      this.endMissed(t, now, fx, "forfeit", "no_show");
      return;
    }
    this.change(t.id, endPatch("EXPIRED", "validity", now), now, fx);
    if (t.state === "BOOKED") {
      this.paymentAction(t, "forfeit", 0, "not_checked_in", now);
    } else {
      this.paymentAction(t, "refund", 100, "validity", now);
    }
  }

  // =====================================================================
  // Internals: mutation pipeline
  // =====================================================================

  /**
   * Runs `op` in one synchronous storage transaction, then (on success)
   * broadcasts, reschedules the alarm and applies the D1 rows (token rows,
   * snapshot) before returning, so the caller can read its own write from D1.
   * Pushes, analytics and strikes drain in the background (G2): an Expo call
   * or a slow push batch never delays a join or a Next. `view` builds the
   * returned value after the change is committed.
   */
  private async mutate<V, R = V>(
    name: string,
    op: (now: number, fx: Fx) => DoResult<V>,
    view?: (now: number, value: V) => R,
  ): Promise<DoResult<R>> {
    const t0 = Date.now();
    const now = this.now();
    const fx = newFx();
    let result: DoResult<V>;
    try {
      result = this.ctx.storage.transactionSync(() => {
        const r = op(now, fx);
        if (!r.ok) throw new Rollback(r);
        if (fx.changed) this.afterChange(now, fx);
        return r;
      });
    } catch (e) {
      this.store.invalidate();
      if (e instanceof Rollback) return e.result as DoResult<R>;
      throw e;
    }
    if (fx.changed) this.broadcast(now, fx);
    const t1 = Date.now();
    let t2 = t1;
    let rows = 0;
    if (fx.changed) {
      await this.reschedule(true);
      t2 = Date.now();
      // Bounded: if D1 is slow, answer anyway after ROWS_WAIT_MS (the rows
      // land shortly after; the alarm is the safety net). -1 in the log.
      rows = await withTimeout(this.drainRows(), ROWS_WAIT_MS, "rows").catch(
        () => -1,
      );
      this.ctx.waitUntil(this.drainSide());
    }
    const t3 = Date.now();
    if (t3 - t0 >= SLOW_RPC_MS) {
      this.logTiming("rpc", name, {
        txMs: t1 - t0,
        alarmMs: t2 - t1,
        rowsMs: t3 - t2,
        totalMs: t3 - t0,
        rows,
      });
    }
    if (!result.ok) return result;
    const value = view
      ? view(this.now(), result.value)
      : (result.value as unknown as R);
    return ok(value);
  }

  /**
   * Timing of a slow RPC or drain (≥ SLOW_RPC_MS): op name, queue id and
   * durations/counts only — never user ids, tokens' owners or locations.
   */
  private logTiming(
    kind: "rpc" | "drain",
    name: string,
    fields: Record<string, number>,
  ): void {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        where: `queue-do.slow-${kind}`,
        op: name,
        queueId: this.store.get("queue_id"),
        ...fields,
      }),
    );
  }

  /** Updates a token, bumps its rev, records the D1 upsert and marks it touched. */
  private change(
    id: string,
    patch: Partial<Omit<TokenRow, "id" | "rev">>,
    now: number,
    fx: Fx,
  ): TokenRow {
    const row = this.store.updateToken(id, patch);
    if (patch.state === "SERVED") {
      this.store.set("last_served", tokenLabel(row.series, row.number));
    }
    this.recordToken(id, now);
    fx.changed = true;
    fx.touched.add(id);
    return row;
  }

  /** Outbox `token_upsert` with the full row (idempotent by id + rev). */
  private recordToken(id: string, now: number): void {
    const t = this.store.token(id);
    const s = this.store;
    const queueId = s.get("queue_id");
    const businessId = s.get("business_id");
    if (!t || !queueId || !businessId) return;
    const payload: TokenUpsertPayload = {
      id: t.id,
      queueId,
      sessionId: t.session_id,
      businessId,
      userId: t.user_id,
      number: t.number,
      series: t.series,
      cls: t.cls,
      method: t.method,
      state: t.state,
      joinedAt: t.joined_at,
      calledAt: t.called_at,
      servedAt: t.served_at,
      endedAt: t.ended_at,
      endReason: t.end_reason,
      paymentId: t.payment_id,
      rev: t.rev,
      at: now,
      deviceHash: t.device_hash,
      expiresAt: t.expires_at,
      checkCode: t.check_code,
      checkedInAt: t.checked_in_at,
      missedAt: t.missed_at,
    };
    s.enqueue("token_upsert", payload, now);
  }

  /**
   * PRI-11 / misuse table: staff actions and every call are logged with their
   * time (ids and labels only; never user ids, names or locations).
   */
  private audit(
    action: string,
    now: number,
    fields: Record<string, string | number | null>,
  ): void {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        where: "queue-do.audit",
        action,
        queueId: this.store.get("queue_id"),
        at: now,
        ...fields,
      }),
    );
  }

  private bump(now: number, delta: Partial<HourlyCounts>): void {
    this.store.bump(istHourStart(now), delta);
  }

  /**
   * After any change (and on every alarm): head/next and head-back alerts,
   * snapshot flush (≤ 30 s, only when changed), hourly analytics rollover.
   */
  private afterChange(now: number, fx: Fx): void {
    const s = this.store;
    const status = s.get("status");
    this.refreshNowServing(status);

    if (status !== "closed") {
      // "You're next" once a token reaches the head (not when joining at the head).
      const head = this.callOrderRows(1)[0];
      if (head && head.id !== fx.allocatedId) this.alert(head, "next", now);

      // "Head back now" (only while service is running).
      if (status === "open") {
        for (const t of this.headBackDue(now)) {
          if (t.due <= now) this.alert(t.row, "head_back", now);
        }
      }
    }

    const snap = s.get("snapshot");
    const dirty = snap.dirty || fx.changed;
    if (
      dirty &&
      (fx.snapshotNow ||
        snap.lastAt === null ||
        now - snap.lastAt >= SNAPSHOT_MIN_INTERVAL_MS)
    ) {
      this.enqueueSnapshot(now);
      s.set("snapshot", { dirty: false, lastAt: now });
    } else if (dirty !== snap.dirty) {
      s.set("snapshot", { dirty, lastAt: snap.lastAt });
    }

    this.flushHourly(now, false);
  }

  /**
   * "Now serving" (coordinator report 2026-10-16): the token at a counter
   * that was called last; when nobody is at a counter, the last token SERVED
   * this session; null when closed. A called token that leaves, is skipped,
   * misses its turn (grace) or is undone therefore stops showing at once.
   */
  private refreshNowServing(status: Meta["status"]): void {
    const s = this.store;
    let label: string | null = null;
    if (status !== "closed") {
      const called = s.latestCalled();
      label = called
        ? tokenLabel(called.series, called.number)
        : s.get("last_served");
    }
    if (label !== s.get("now_serving")) s.set("now_serving", label);
  }

  /**
   * Waiting tokens in predicted call order (the lanes merged by the credit
   * rule, PRI-06). With `limit`, each lane is read up to `limit` rows; the
   * first `limit` positions are still exact.
   */
  private callOrderRows(limit?: number): TokenRow[] {
    const s = this.store;
    const [t, p, r] = [0, 1, 2].map((rank) => s.waitingInLane(rank, limit));
    const order = callOrder(
      { triage: t, priority: p, regular: r },
      s.get("priority_credits"),
      s.get("settings").priorityPerRegular,
    );
    return limit === undefined ? order : order.slice(0, limit);
  }

  /** Waiting tokens (first 50, ≥ 1 ahead) without a head-back alert, with their due time. */
  private headBackDue(now: number): { row: TokenRow; due: number }[] {
    const ctx = etaContext(this.store, now);
    const out: { row: TokenRow; due: number }[] = [];
    const rows = this.callOrderRows(HEAD_BACK_SCAN);
    rows.forEach((row, position) => {
      if (position === 0 || row.alert_flags & ALERT_BITS.head_back) return;
      const est = estimateFor(ctx, now, position);
      out.push({
        row,
        due: Math.max(
          est.expectedMs - HEAD_BACK_LEAD_MS,
          row.joined_at + HEAD_BACK_MIN_AGE_MS,
        ),
      });
    });
    return out;
  }

  private enqueueSnapshot(now: number): void {
    const s = this.store;
    const queueId = s.get("queue_id");
    const businessId = s.get("business_id");
    if (!queueId || !businessId) return;
    const sum = this.summary(now);
    const payload: SnapshotPayload = {
      queueId,
      businessId,
      isOpen: sum.status !== "closed",
      isPaused: sum.status === "paused",
      waiting: sum.waiting,
      etaLowMs: sum.waitLowMs,
      etaHighMs: sum.waitHighMs,
      nowServing: sum.nowServing,
      updatedAt: now,
      inService: sum.inService,
    };
    s.enqueue("snapshot", payload, now);
  }

  /** Hours before the current IST hour (or all, on close) go to D1 via the outbox. */
  private flushHourly(now: number, all: boolean): void {
    const s = this.store;
    const queueId = s.get("queue_id");
    const businessId = s.get("business_id");
    if (!queueId || !businessId) return;
    const rows = s.hourlyRows(all ? undefined : istHourStart(now));
    for (const r of rows) {
      const counts = pickCounts(r);
      if (Object.values(counts).some((v) => v !== 0)) {
        const payload: AnalyticsPayload = {
          queueId,
          businessId,
          hourStart: r.hour_start,
          counts,
        };
        s.enqueue("analytics", payload, now);
      }
      s.deleteHour(r.hour_start);
    }
  }

  /** Sets the alert bit first, then enqueues the push (ALR-04: at most once). */
  private alert(row: TokenRow, kind: AlertKind, now: number): void {
    const bit = ALERT_BITS[kind];
    const current = this.store.token(row.id);
    if (!current || current.alert_flags & bit) return;
    this.store.setAlertFlags(row.id, current.alert_flags | bit);
    const queueId = this.store.get("queue_id");
    if (!current.user_id || !queueId) return;
    const text = alertText(kind, {
      queueName: this.store.get("labels").queueName,
      counter: current.counter,
      graceMinutes: Math.round(current.grace_ms / 60_000),
    });
    this.store.enqueue(
      "push",
      {
        userId: current.user_id,
        tokenId: current.id,
        queueId,
        kind,
        title: text.title,
        body: text.body,
      },
      now,
    );
  }

  // =====================================================================
  // Internals: alarm scheduling + outbox drain
  // =====================================================================

  private dueTimes(now: number, inlineDrain = false): DueTimes {
    const s = this.store;
    const outbox = s.nextOutboxAttempt();
    const snap = s.get("snapshot");
    const far = s.get("far");
    const hour = s.earliestHour();
    const headBack =
      s.get("status") === "open"
        ? this.headBackDue(now).reduce<number | null>(
            (min, t) => (min === null || t.due < min ? t.due : min),
            null,
          )
        : null;
    return {
      graceExpiry: s.nextGraceExpiry(),
      snapshotFlush: snap.dirty
        ? (snap.lastAt ?? now) + SNAPSHOT_MIN_INTERVAL_MS
        : null,
      // While the caller is about to drain inline, items due now only need a
      // safety-net alarm (if this drain dies) after the first backoff step.
      outboxRetry:
        outbox !== null && inlineDrain
          ? Math.max(outbox, now + OUTBOX_INLINE_SAFETY_MS)
          : outbox,
      headBackAlert: headBack,
      hourlyFlush: hour === null ? null : hour + HOUR_MS,
      farFanout: far.dirty
        ? (far.lastAt ?? now) + FAR_FANOUT_INTERVAL_MS
        : null,
      validityExpiry: s.nextValidityExpiry(),
      autoClose: this.autoCloseDeadline(),
    };
  }

  /**
   * QUE-16: one alarm at the earliest due time (in real time, minus the test
   * offset). `inlineDrain`: the caller drains the outbox right after this, so
   * fresh items don't pull the alarm to "now" (F1: such an alarm was usually
   * superseded by the drain's own reschedule and reported as `canceled`).
   */
  private async reschedule(inlineDrain = false): Promise<void> {
    const now = this.now();
    const at = earliestDue(this.dueTimes(now, inlineDrain));
    if (at === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const offset = this.store.get("clock_offset_ms");
    await this.ctx.storage.setAlarm(
      Math.max(at, now + MIN_ALARM_DELAY_MS) - offset,
    );
  }

  /**
   * Applies every due outbox item: rows, then the rest. Used by the alarm and
   * `flushOutbox`; mutations await only `drainRows` (see `mutate`).
   */
  private async drainOutbox(): Promise<void> {
    await this.drainRows();
    await this.drainSide();
  }

  /**
   * Token rows and snapshots, batched (one D1 round trip per ≤ 50 items).
   * Row drains are chained: one at a time, and a caller's drain starts after
   * its own items were written. Each batch is bounded by a timeout so a stuck
   * D1 call can't hold every later mutation of this queue (G2); the rows are
   * idempotent, so a late success plus a retry is harmless.
   */
  private drainRows(): Promise<number> {
    const run = this.rowChain.then(() => this.drainRowsOnce());
    this.rowChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run.catch(() => 0);
  }

  /**
   * Pushes, analytics and strikes. Chained (one at a time, so a push item is
   * never applied by two drains at once: no duplicates from concurrency), and
   * each run starts after the row drain queued before it, so a push ticket or
   * strike always finds its token row.
   */
  private drainSide(): Promise<void> {
    const rowsBefore = this.rowChain;
    const run = this.sideChain
      .then(() => rowsBefore)
      .then(() => this.drainSideOnce());
    this.sideChain = run.catch(() => undefined);
    return this.sideChain;
  }

  /** Test/debug: waits until every drain queued so far has finished. */
  async flushOutbox(): Promise<number> {
    await this.drainOutbox();
    return this.store.outboxCount();
  }

  private async drainRowsOnce(): Promise<number> {
    const t0 = Date.now();
    const deps = { d1: this.env.DB, push: pushTransport(this.env) };
    let applied = 0;
    for (let round = 0; round < 10; round++) {
      const now = this.now();
      const rows = this.store.dueOutboxKinds(now, 50, ROW_KINDS);
      if (rows.length === 0) break;
      try {
        await withTimeout(
          applyOutboxRows(rows, deps),
          ROW_BATCH_TIMEOUT_MS,
          "D1 row batch",
        );
        for (const item of rows) this.store.deleteOutbox(item.id);
        applied += rows.length;
      } catch (e) {
        for (const item of rows) this.outboxFailed(item, now, e);
        break;
      }
    }
    // A side drain always follows a row drain, so fresh side items only need
    // the safety-net alarm here (keeps F1's superseded alarms away).
    await this.reschedule(true);
    const ms = Date.now() - t0;
    if (ms >= SLOW_RPC_MS) this.logTiming("drain", "rows", { ms, applied });
    return applied;
  }

  private async drainSideOnce(): Promise<void> {
    const t0 = Date.now();
    const deps = { d1: this.env.DB, push: pushTransport(this.env) };
    let pushed = 0;
    let other = 0;
    for (let round = 0; round < 10; round++) {
      const now = this.now();
      const due = this.store.dueOutboxKinds(now, 25, SIDE_KINDS);
      if (due.length === 0) break;
      let progressed = false;
      // Pushes together: one device lookup, one Expo call, one ticket write.
      const pushes = due.filter((i) => i.kind === "push");
      if (pushes.length > 0) {
        try {
          await applyOutboxPushes(pushes, deps, now);
          for (const item of pushes) this.store.deleteOutbox(item.id);
          pushed += pushes.length;
          progressed = true;
        } catch (e) {
          for (const item of pushes) this.outboxFailed(item, now, e);
        }
      }
      for (const item of due) {
        if (item.kind === "push") continue;
        try {
          await applyOutboxItem(item, deps, now);
          this.store.deleteOutbox(item.id);
          other++;
          progressed = true;
        } catch (e) {
          this.outboxFailed(item, now, e);
        }
      }
      if (!progressed) break;
    }
    await this.reschedule();
    const ms = Date.now() - t0;
    if (ms >= SLOW_RPC_MS) {
      this.logTiming("drain", "side", { ms, pushed, other });
    }
  }

  private outboxFailed(item: OutboxRow, now: number, e: unknown): void {
    const attempts = item.attempts + 1;
    this.store.retryOutbox(item.id, attempts, now + outboxBackoff(attempts));
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        where: "queue-do.outbox",
        queueId: this.store.get("queue_id"),
        kind: item.kind,
        attempts,
        message: e instanceof Error ? e.message : String(e),
      }),
    );
  }

  // =====================================================================
  // Internals: live fan-out
  // =====================================================================

  /**
   * Console sockets get the full state on every change. Token sockets within
   * the first 20 positions (or touched, or not waiting) get it immediately;
   * the rest at most every 30 s (alarm-driven).
   */
  private broadcast(now: number, fx: Fx): void {
    const sockets = this.ctx.getWebSockets();
    const s = this.store;
    const far = s.get("far");
    if (sockets.length === 0) {
      if (far.dirty) s.set("far", { dirty: false, lastAt: far.lastAt });
      return;
    }
    const farDue =
      far.lastAt === null || now - far.lastAt >= FAR_FANOUT_INTERVAL_MS;
    let consoleMsg: string | null = null;
    let farSent = false;
    let farPending = false;
    let vc: ViewCtx | null = null;

    for (const ws of sockets) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att) continue;
      if (att.kind === "console") {
        if (!fx.changed) continue;
        consoleMsg ??= encode({
          type: "queue",
          console: this.consoleState(now),
        });
        safeSend(ws, consoleMsg);
        continue;
      }
      const row = s.token(att.tokenId);
      if (!row) continue;
      vc ??= this.viewCtx(now);
      const view = this.tokenView(row, now, vc);
      const touched = fx.touched.has(row.id);
      const near =
        touched ||
        view.state !== "WAITING" ||
        view.peopleAhead < NEAR_POSITIONS;
      if (near) {
        if (fx.changed) safeSend(ws, encode({ type: "token", token: view }));
      } else if (farDue && (fx.changed || far.dirty)) {
        safeSend(ws, encode({ type: "token", token: view }));
        farSent = true;
      } else if (fx.changed) {
        farPending = true;
      }
    }
    if (farSent) s.set("far", { dirty: false, lastAt: now });
    else if (farPending && !far.dirty) {
      s.set("far", { dirty: true, lastAt: far.lastAt ?? now });
    } else if (far.dirty && farDue && !farPending) {
      // The held-back sockets moved near (already updated) or closed: nothing
      // is owed. Without this the flag stayed set with a due time in the past
      // and the alarm re-fired every 250 ms (Step 3.5 finding, F3 queue).
      s.set("far", { dirty: false, lastAt: far.lastAt });
    }
  }

  // =====================================================================
  // Internals: views
  // =====================================================================

  private viewById(id: string, now: number): TokenView {
    const row = this.store.token(id);
    if (!row) throw new Error(`token ${id} missing`);
    return this.tokenView(row, now);
  }

  /** Lane counts, credits, ETA inputs and settings shared by the views of one call. */
  private viewCtx(now: number): ViewCtx {
    const s = this.store;
    const settings = s.get("settings");
    const counts = s.laneCounts();
    return {
      eta: etaContext(s, now),
      settings,
      status: s.get("status"),
      soldOut: this.sales(now).soldOut,
      lanes: {
        triageWaiting: counts.triage,
        priorityWaiting: counts.priority,
        regularWaiting: counts.regular,
        credits: s.get("priority_credits"),
        perRegular: settings.priorityPerRegular,
        priorityEnabled: settings.priorityEnabled,
      },
    };
  }

  /** People ahead of a WAITING token by its lane (PRI-06/PRI-08, C3). */
  private aheadOf(row: TokenRow, vc: ViewCtx): PeopleAheadRange {
    const s = this.store;
    const rank = rankOf(row.sort_key);
    if (rank === 0) {
      const n = s.peopleAhead(row.sort_key);
      return { low: n, high: n };
    }
    if (rank === 1) {
      const q = s.countWaitingBetween(RANK_SPAN, row.sort_key);
      const n = priorityPeopleAhead(vc.lanes, q);
      return { low: n, high: n };
    }
    const r = s.countWaitingBetween(2 * RANK_SPAN, row.sort_key);
    return regularPeopleAhead(vc.lanes, r);
  }

  /** ETA range covering both ends of a people-ahead range (C3). */
  private estimateRange(
    vc: ViewCtx,
    now: number,
    ahead: PeopleAheadRange,
  ): { lowMs: number; highMs: number; expectedMs: number; beBackByMs: number } {
    const lo = estimateFor(vc.eta, now, ahead.low);
    const hi =
      ahead.high === ahead.low ? lo : estimateFor(vc.eta, now, ahead.high);
    return {
      lowMs: lo.lowMs,
      highMs: hi.highMs,
      expectedMs: lo.expectedMs,
      beBackByMs: lo.beBackByMs,
    };
  }

  /**
   * PRI-05 / C2 offer for a WAITING regular ticket: its own wait now vs. the
   * wait at the end of the priority lane if it upgraded now. Null when it
   * can't upgrade or the lane is off.
   */
  private upgradeOffer(
    row: TokenRow,
    vc: ViewCtx,
    now: number,
    ahead: PeopleAheadRange = this.aheadOf(row, vc),
  ): { pricePaise: number; savingMin: number; show: boolean } | null {
    if (!vc.settings.priorityEnabled || !isUpgradable(row)) return null;
    if (vc.status === "closed") return null;
    const mine = this.estimateRange(vc, now, ahead);
    const asPriority = estimateFor(
      vc.eta,
      now,
      newPriorityPeopleAhead({
        ...vc.lanes,
        regularWaiting: Math.max(0, vc.lanes.regularWaiting - 1),
      }),
    );
    const savingMin = savingMinutes(mine, asPriority);
    return {
      pricePaise: vc.settings.priorityFeePaise,
      savingMin,
      show:
        !vc.soldOut && showSaving(savingMin, vc.settings.upgradeMinSavingMin),
    };
  }

  private tokenView(
    row: TokenRow,
    now: number,
    vc: ViewCtx = this.viewCtx(now),
  ): TokenView {
    const s = this.store;
    const status = vc.status;
    const labels = s.get("labels");
    const waiting = row.state === "WAITING";
    const range = waiting ? this.aheadOf(row, vc) : { low: 0, high: 0 };
    const est =
      waiting && status !== "closed"
        ? this.estimateRange(vc, now, range)
        : null;
    const lane: TokenClass = waiting ? laneOf(row.sort_key) : row.cls;
    const missed = row.state === "MISSED";
    return {
      id: row.id,
      queueId: s.get("queue_id") ?? "",
      businessId: s.get("business_id") ?? "",
      businessName: labels.businessName,
      queueName: labels.queueName,
      number: row.number,
      series: row.series,
      label: tokenLabel(row.series, row.number),
      method: row.method,
      state: row.state,
      queueStatus: status,
      peopleAhead: range.low,
      nowServing: s.get("now_serving"),
      etaLowMs: est?.lowMs ?? null,
      etaHighMs: est?.highMs ?? null,
      beBackByMs: est?.beBackByMs ?? null,
      leaveHomeByMs: null,
      counter: row.counter,
      joinedAt: row.joined_at,
      calledAt: row.called_at,
      graceUntil: row.grace_until,
      endedAt: row.ended_at,
      endReason: row.end_reason,
      paid: isPaid(row),
      rev: row.rev,
      sessionId: row.session_id,
      cls: row.cls,
      expiresAt: row.expires_at,
      carriedOver: row.carried === 1,
      checkCode: row.check_code,
      lane,
      peopleAheadHigh: range.high,
      graceEndsAt: row.grace_until,
      missedAt: row.missed_at,
      rejoinAvailable: missed && row.rejoined === 0 && status !== "closed",
      rejoinUntil:
        missed && row.missed_at !== null
          ? lateWindowEndsAt(row.missed_at, vc.settings.lateWindowMin)
          : null,
      rejoined: row.rejoined === 1,
      checkedInAt: row.checked_in_at,
      validUntil: row.state === "BOOKED" ? row.expires_at : null,
      priority: priorityInfo(vc.settings),
      upgrade: waiting ? this.upgradeOffer(row, vc, now, range) : null,
      cancelRefundPct: this.cancelRefundPct(row, now, vc),
    };
  }

  private summary(
    now: number,
    vc: ViewCtx = this.viewCtx(now),
  ): QueueLiveSummary {
    const s = this.store;
    const status = vc.status;
    const l = vc.lanes;
    const waiting = l.triageWaiting + l.priorityWaiting + l.regularWaiting;
    let waitLowMs: number | null = null;
    let waitHighMs: number | null = null;
    let pLow: number | null = null;
    let pHigh: number | null = null;
    if (status !== "closed") {
      const est = this.estimateRange(vc, now, newRegularPeopleAhead(l));
      waitLowMs = est.lowMs - now;
      waitHighMs = est.highMs - now;
      const p = estimateFor(vc.eta, now, newPriorityPeopleAhead(l));
      pLow = p.lowMs - now;
      pHigh = p.highMs - now;
    }
    return {
      status,
      nowServing: s.get("now_serving"),
      waiting,
      waitLowMs,
      waitHighMs,
      updatedAt: now,
      inService: s.countState("CALLED"),
      priority: {
        enabled: vc.settings.priorityEnabled,
        perRegular: vc.settings.priorityPerRegular,
        waiting: l.priorityWaiting,
        waitLowMs: pLow,
        waitHighMs: pHigh,
        soldOut: vc.soldOut,
      },
    };
  }

  private consoleState(now: number): ConsoleState {
    const s = this.store;
    const settings = s.get("settings");
    const vc = this.viewCtx(now);
    const toConsole = (t: TokenRow, position: number | null): ConsoleToken => ({
      id: t.id,
      number: t.number,
      series: t.series,
      label: tokenLabel(t.series, t.number),
      cls: t.cls,
      method: t.method,
      state: t.state,
      position,
      joinedAt: t.joined_at,
      calledAt: t.called_at,
      counter: t.counter,
      graceUntil: t.grace_until,
      paid: isPaid(t),
      carriedOver: t.carried === 1,
      expiresAt: t.expires_at,
      checkCode: t.check_code,
      lane: t.state === "WAITING" ? laneOf(t.sort_key) : t.cls,
      missedAt: t.missed_at,
      rejoined: t.rejoined === 1,
      checkedInAt: t.checked_in_at,
    });
    const waiting = this.callOrderRows().map((t, i) => toConsole(t, i + 1));
    const serving = s.byState("CALLED").map((t) => toConsole(t, null));
    const grace = s.byState("GRACE").map((t) => toConsole(t, null));
    const missed = s.byState("MISSED").map((t) => toConsole(t, null));
    const ctx = vc.eta;
    const sum = this.summary(now, vc);
    const undo = s.get("undo");
    const triage = s.get("triage");
    const usedToday = triage.day === istDay(now) ? triage.count : 0;
    return {
      queueId: s.get("queue_id") ?? "",
      sessionId: s.get("session_id"),
      status: s.get("status"),
      nowServing: s.get("now_serving"),
      counters: settings.counters,
      serving,
      waiting,
      grace,
      missed,
      counts: {
        waiting: waiting.length,
        inService: serving.length,
        grace: grace.length,
        total: waiting.length + serving.length + grace.length,
        missed: missed.length,
        booked: s.countState("BOOKED"),
      },
      priority: {
        enabled: settings.priorityEnabled,
        perRegular: settings.priorityPerRegular,
        credits: s.get("priority_credits"),
        soldToday: this.sales(now).count,
        dailyCap: settings.priorityDailyCap,
      },
      eta: {
        meanIntervalMs: Math.round(ctx.rate.meanMs),
        sigmaMs: Math.round(ctx.rate.sigmaMs),
        intervals: s.get("ewma").count,
        coldStart: ctx.rate.coldStart,
        waitLowMs: sum.waitLowMs,
        waitHighMs: sum.waitHighMs,
      },
      undoUntil:
        undo && now - undo.at <= UNDO_WINDOW_MS
          ? undo.at + UNDO_WINDOW_MS
          : null,
      triageLeftToday: Math.max(0, settings.triageDailyCap - usedToday),
      updatedAt: now,
      autoCloseAt: this.autoCloseDeadline(),
    };
  }
}

/** Carries a failed result out of `transactionSync` so nothing is committed. */
class Rollback {
  constructor(readonly result: DoResult<unknown>) {}
}

/** Holds a ticket: BOOKED, WAITING, CALLED, GRACE or MISSED. */
function isActive(t: TokenRow): boolean {
  return (
    t.state === "BOOKED" ||
    t.state === "WAITING" ||
    t.state === "CALLED" ||
    t.state === "GRACE" ||
    t.state === "MISSED"
  );
}

/** Paid: a remote reservation, a pass, or an upgraded ticket. */
function isPaid(t: TokenRow): boolean {
  return t.payment_order_id !== null || t.upgrade_order_id !== null;
}

/** PRI-05: only a WAITING regular ticket in the regular lane can skip ahead. */
function isUpgradable(t: TokenRow): boolean {
  return (
    t.state === "WAITING" &&
    t.cls === "regular" &&
    rankOf(t.sort_key) === 2 &&
    t.upgrade_order_id === null
  );
}

/** Where a token's wait starts: check-in for a pass, else joining. */
function waitStart(t: TokenRow): number {
  return t.series === "P" && t.checked_in_at !== null
    ? t.checked_in_at
    : t.joined_at;
}

function endPatch(
  state: "SERVED" | "EXPIRED" | "LEFT" | "CANCELLED",
  reason: EndReason,
  now: number,
): Partial<TokenRow> {
  return {
    state,
    end_reason: reason,
    ended_at: now,
    grace_until: null,
    ...(state === "SERVED" ? { served_at: now } : {}),
  };
}

function pickCounts(r: HourlyRow): HourlyCounts {
  const out = {} as HourlyCounts;
  for (const k of HOURLY_FIELDS) out[k] = Number(r[k]);
  return out;
}

function safeSend(ws: WebSocket, msg: string): void {
  try {
    ws.send(msg);
  } catch {
    // socket closing; the client reconnects and refetches
  }
}
