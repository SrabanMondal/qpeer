import { DurableObject } from "cloudflare:workers";
import {
  type AlertKind,
  type ConsoleState,
  type ConsoleToken,
  capInterval,
  type EndReason,
  ETA_INTERVAL_WINDOW,
  etaHit,
  ewmaUpdate,
  type JoinMethod,
  type QueueLiveSummary,
  type QueueSettings,
  type TokenClass,
  type TokenSeries,
  type TokenView,
  tokenLabel,
} from "@qpeer/shared";
import { pushTransport } from "../modules/notifications/expo-push";
import {
  type EtaContext,
  estimateFor,
  etaContext,
  pausedTotalNow,
} from "./eta";
import { allocateSortKey, skipSortKey } from "./ordering";
import {
  type AnalyticsPayload,
  applyOutboxItem,
  applyOutboxPushes,
  applyOutboxRows,
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
  type OutboxKind,
  type OutboxRow,
  QueueStore,
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
  | "quota_full"
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
  }[];
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
const ROW_KINDS: OutboxKind[] = ["token_upsert", "snapshot"];
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
        s.pruneOldSessions(sessionId);
        fx.changed = true;
        fx.snapshotNow = true;
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
  }

  /**
   * QUE-09: ends the session; every active token expires (`queue_closed` alert).
   * Returns paid tokens so the Worker can refund them (Step 4). Idempotent.
   */
  async close(): Promise<
    DoResult<{
      console: ConsoleState;
      paidTokens: { tokenId: string; paymentOrderId: string }[];
    }>
  > {
    const paidTokens: { tokenId: string; paymentOrderId: string }[] = [];
    return this.mutate(
      "close",
      (now, fx) => {
        const s = this.store;
        if (s.get("status") === "closed") return ok(null);
        for (const t of s.active()) {
          this.alert(t, "queue_closed", now);
          this.change(t.id, endPatch("EXPIRED", "closed", now), now, fx);
          if (t.payment_order_id) {
            paidTokens.push({
              tokenId: t.id,
              paymentOrderId: t.payment_order_id,
            });
          }
        }
        s.set("status", "closed");
        s.set("paused_since", null);
        s.set("undo", null);
        s.set("now_serving", null);
        this.flushHourly(now, true);
        fx.changed = true;
        fx.snapshotNow = true;
        return ok(null);
      },
      (now) => ({ console: this.consoleState(now), paidTokens }),
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

  /** Can a remote reservation be made right now? (used before creating an order, Step 4) */
  async checkQuota(userId: string): Promise<DoResult<{ available: true }>> {
    const s = this.store;
    const status = s.get("status");
    if (status === "closed") return fail("queue_closed", "Queue is closed");
    if (status === "paused") return fail("queue_paused", "Queue is paused");
    const settings = s.get("settings");
    if (s.countState("WAITING") >= settings.maxSize) {
      return fail("queue_full", "Queue is full");
    }
    const paid = s
      .activeForUser(userId)
      .filter((t) => t.payment_order_id !== null).length;
    if (paid >= settings.paidPerUserCap) {
      return fail("quota_full", "Paid token limit reached for this queue");
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
        const free = mine.find(
          (t) => t.payment_order_id === null && t.method !== "staff",
        );
        if (free) {
          return fail("already_in_queue", "You already have a token here", {
            tokenId: free.id,
          });
        }
      } else if (
        mine.filter((t) => t.payment_order_id !== null).length >=
        settings.paidPerUserCap
      ) {
        return fail("quota_full", "Paid token limit reached for this queue");
      }
    }
    if (input.method === "remote" && !this.remoteQuotaAvailable()) {
      return fail("quota_full", "Reservations are full right now");
    }

    const series = SERIES[input.cls];
    const numbers = s.get("next_number");
    const number = numbers[series];
    s.set("next_number", { ...numbers, [series]: number + 1 });
    const sortKey = allocateSortKey(s, input.cls);
    const ahead = s.peopleAhead(sortKey);
    const est = estimateFor(etaContext(s, now), now, ahead);
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
      alert_flags: ahead === 0 ? ALERT_BITS.next : 0,
      rev: 1,
      grace_ms: settings.graceMinutes * 60_000,
      cancel_window_ms: settings.cancelWindowMin * 60_000,
      eta_low_at_join: est.lowMs,
      eta_high_at_join: est.highMs,
    });
    this.recordToken(id, now);
    this.bump(now, { joins: 1 });
    fx.changed = true;
    fx.touched.add(id);
    fx.allocatedId = id;
    return ok({ id, created: true });
  }

  private remoteQuotaAvailable(): boolean {
    const settings = this.store.get("settings");
    const cap = Math.floor(
      (settings.maxSize * (100 - settings.walkinQuotaPct)) / 100,
    );
    return this.store.countWaitingRemote() < cap;
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
        const head = s.waiting(1)[0] ?? null;
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

        if (head) {
          const lastCall = s.get("last_call_at");
          if (lastCall !== null) {
            const ref = Math.max(lastCall, head.joined_at);
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
          add("waits", 1);
          add("sum_wait_ms", now - head.joined_at);
          if (head.eta_low_at_join !== null && head.eta_high_at_join !== null) {
            add("eta_total", 1);
            if (etaHit(now, head.eta_low_at_join, head.eta_high_at_join)) {
              add("eta_hits", 1);
            }
          }
          this.alert(called, "called", now);
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

  /** QUE-06: the token goes behind the next 3 waiting tokens (or to the end). */
  async skip(tokenId: string): Promise<DoResult<ConsoleState>> {
    return this.mutate(
      "skip",
      (now, fx) => {
        const t = this.store.token(tokenId);
        if (!t) return fail("not_found", "Token not found");
        if (t.state !== "WAITING" && t.state !== "CALLED") {
          return fail("invalid_state", `Can't skip a ${t.state} token`);
        }
        const key = skipSortKey(this.store, tokenId);
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
        return ok(null);
      },
      (now) => this.consoleState(now),
    );
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

  /** QUE-10: leave at any time. `userId` null = staff acting for the customer. */
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
        this.change(tokenId, endPatch("LEFT", "left", now), now, fx);
        this.bump(now, { leaves: 1 });
        return ok(null);
      },
      (now) => this.viewById(tokenId, now),
    );
  }

  /**
   * Cancel: free tokens = leave. Paid tokens (Step 4) → CANCELLED, and `refund`
   * says whether the cancel window applies (now − joinedAt ≤ cancelWindowMin).
   */
  async cancel(
    tokenId: string,
    userId: string | null,
  ): Promise<DoResult<{ token: TokenView; refund: boolean }>> {
    let refund = false;
    return this.mutate(
      "cancel",
      (now, fx) => {
        const t = this.store.token(tokenId);
        if (!t || (userId !== null && t.user_id !== userId)) {
          return fail("not_found", "Token not found");
        }
        if (!t.payment_order_id) {
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
        // TODO(Step 4): the Worker turns `refund` into a Razorpay refund.
        refund = now - t.joined_at <= t.cancel_window_ms;
        this.change(tokenId, endPatch("CANCELLED", "cancelled", now), now, fx);
        this.bump(now, { cancels: 1 });
        return ok(null);
      },
      (now) => ({ token: this.viewById(tokenId, now), refund }),
    );
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

  /** Active (WAITING/CALLED/GRACE) tokens, for archive (BIZ-11). */
  async countActiveTokens(): Promise<number> {
    return this.store.countActive();
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
    return {
      queueId: s.get("queue_id"),
      sessionId: s.get("session_id"),
      status: s.get("status"),
      waiting: s.countState("WAITING"),
      pendingOutbox: s.outboxCount(),
      tokens: s.allTokens().map((t) => ({
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
        peopleAhead: t.state === "WAITING" ? s.peopleAhead(t.sort_key) : null,
      })),
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

  /** QUE-08: grace ran out → EXPIRED (no-show); free walk-ins get a strike (JON-07). */
  private expireGrace(t: TokenRow, now: number, fx: Fx): void {
    this.change(t.id, endPatch("EXPIRED", "no_show", now), now, fx);
    this.bump(now, { no_shows: 1 });
    if (t.user_id && t.payment_order_id === null && t.method === "walkin") {
      this.store.enqueue(
        "strike",
        { userId: t.user_id, tokenId: t.id, at: now },
        now,
      );
    }
    // TODO(Step 4): paid token expiry → forfeit via outbox.
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
      // Step 4 maps payment_order_id → payments.id.
      paymentId: null,
      rev: t.rev,
      at: now,
    };
    s.enqueue("token_upsert", payload, now);
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

    if (status !== "closed") {
      // "You're next" once a token reaches the head (not when joining at the head).
      const head = s.waiting(1)[0];
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

  /** Waiting tokens (first 50, ≥ 1 ahead) without a head-back alert, with their due time. */
  private headBackDue(now: number): { row: TokenRow; due: number }[] {
    const ctx = etaContext(this.store, now);
    const out: { row: TokenRow; due: number }[] = [];
    const rows = this.store.waiting(HEAD_BACK_SCAN);
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
      const view = this.tokenView(row, now);
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

  private tokenView(
    row: TokenRow,
    now: number,
    ctx: EtaContext = etaContext(this.store, now),
  ): TokenView {
    const s = this.store;
    const status = s.get("status");
    const labels = s.get("labels");
    const waiting = row.state === "WAITING";
    const ahead = waiting ? s.peopleAhead(row.sort_key) : 0;
    const est =
      waiting && status !== "closed" ? estimateFor(ctx, now, ahead) : null;
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
      peopleAhead: ahead,
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
      paid: row.payment_order_id !== null,
    };
  }

  private summary(now: number): QueueLiveSummary {
    const s = this.store;
    const status = s.get("status");
    const waiting = s.countState("WAITING");
    let waitLowMs: number | null = null;
    let waitHighMs: number | null = null;
    if (status !== "closed") {
      const est = estimateFor(etaContext(s, now), now, waiting);
      waitLowMs = est.lowMs - now;
      waitHighMs = est.highMs - now;
    }
    return {
      status,
      nowServing: s.get("now_serving"),
      waiting,
      waitLowMs,
      waitHighMs,
      updatedAt: now,
    };
  }

  private consoleState(now: number): ConsoleState {
    const s = this.store;
    const settings = s.get("settings");
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
      paid: t.payment_order_id !== null,
    });
    const waiting = s.waiting().map((t, i) => toConsole(t, i + 1));
    const serving = s.byState("CALLED").map((t) => toConsole(t, null));
    const grace = s.byState("GRACE").map((t) => toConsole(t, null));
    const ctx = etaContext(s, now);
    const sum = this.summary(now);
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
      counts: {
        waiting: waiting.length,
        inService: serving.length,
        grace: grace.length,
        total: waiting.length + serving.length + grace.length,
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
    };
  }
}

/** Carries a failed result out of `transactionSync` so nothing is committed. */
class Rollback {
  constructor(readonly result: DoResult<unknown>) {}
}

function isActive(t: TokenRow): boolean {
  return t.state === "WAITING" || t.state === "CALLED" || t.state === "GRACE";
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
