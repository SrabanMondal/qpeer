import type {
  EndReason,
  EwmaState,
  JoinMethod,
  LiveStatus,
  QueueSettings,
  TokenClass,
  TokenSeries,
  TokenState,
} from "@qpeer/shared";
import { defaultQueueSettings, EMPTY_EWMA } from "@qpeer/shared";

/**
 * DO-local SQLite schema and typed queries (architecture doc §9.2, §18).
 * Schema changes are applied lazily in `migrate()`, keyed by `schema_version`
 * in `meta`. Every value in `meta` is JSON text.
 */
export const SCHEMA_VERSION = 1;

export type TokenRow = {
  id: string;
  session_id: string;
  number: number;
  series: TokenSeries;
  cls: TokenClass;
  method: JoinMethod;
  user_id: string | null;
  state: TokenState;
  sort_key: number;
  joined_at: number;
  called_at: number | null;
  counter: number | null;
  grace_until: number | null;
  served_at: number | null;
  ended_at: number | null;
  end_reason: EndReason | null;
  payment_order_id: string | null;
  /** Bitmask of alerts already sent (see ALERT_BITS). */
  alert_flags: number;
  /** Per-token revision; D1 upserts only apply a higher rev. */
  rev: number;
  /** Settings captured at allocation (settings apply to new tokens only). */
  grace_ms: number;
  cancel_window_ms: number;
  eta_low_at_join: number | null;
  eta_high_at_join: number | null;
};

export type OutboxKind =
  | "token_upsert"
  | "snapshot"
  | "analytics"
  | "strike"
  | "push";

export type OutboxRow = {
  id: string;
  kind: OutboxKind;
  payload: string;
  attempts: number;
  next_attempt_at: number;
  created_at: number;
};

export const HOURLY_FIELDS = [
  "joins",
  "leaves",
  "served",
  "no_shows",
  "cancels",
  "sum_wait_ms",
  "waits",
  "sum_interval_ms",
  "intervals",
  "eta_hits",
  "eta_total",
] as const;
export type HourlyField = (typeof HOURLY_FIELDS)[number];
export type HourlyCounts = Record<HourlyField, number>;
export type HourlyRow = { hour_start: number } & HourlyCounts;

/** Undo record for the last Next (QUE-12). */
export interface UndoRecord {
  at: number;
  calledId: string | null;
  calledPrevSortKey: number | null;
  /** Tokens auto-served by this Next (they go back to CALLED on undo). */
  served: { id: string; calledAt: number | null }[];
  prev: {
    ewma: EwmaState;
    lastCallAt: number | null;
    pausedAtLastCall: number;
    nowServing: string | null;
  };
  intervalId: number | null;
  hourStart: number;
  hourlyDelta: Partial<HourlyCounts>;
}

export interface Meta {
  schema_version: number;
  queue_id: string | null;
  business_id: string | null;
  labels: { queueName: string; businessName: string };
  settings: QueueSettings;
  settings_version: number;
  status: LiveStatus;
  session_id: string | null;
  opened_at: number | null;
  next_number: Record<TokenSeries, number>;
  seq: number;
  now_serving: string | null;
  ewma: EwmaState;
  last_call_at: number | null;
  paused_since: number | null;
  paused_total_ms: number;
  paused_at_last_call: number;
  undo: UndoRecord | null;
  clock_offset_ms: number;
  snapshot: { dirty: boolean; lastAt: number | null };
  far: { dirty: boolean; lastAt: number | null };
  triage: { day: number; count: number };
  pings: number;
}

const META_DEFAULTS: Meta = {
  schema_version: 0,
  queue_id: null,
  business_id: null,
  labels: { queueName: "Queue", businessName: "" },
  settings: defaultQueueSettings(),
  settings_version: 0,
  status: "closed",
  session_id: null,
  opened_at: null,
  next_number: { R: 1, P: 1, T: 1 },
  seq: 0,
  now_serving: null,
  ewma: EMPTY_EWMA,
  last_call_at: null,
  paused_since: null,
  paused_total_ms: 0,
  paused_at_last_call: 0,
  undo: null,
  clock_offset_ms: 0,
  snapshot: { dirty: false, lastAt: null },
  far: { dirty: false, lastAt: null },
  triage: { day: 0, count: 0 },
  pings: 0,
};

/** Class rank in the sort key: triage first, then priority, then regular. */
export const CLASS_RANK: Record<TokenClass, number> = {
  triage: 0,
  priority: 1,
  regular: 2,
};
/** sortKey = classRank · RANK_SPAN + sequence · SEQ_STEP (gaps leave room for skips). */
export const RANK_SPAN = 1e15;
export const SEQ_STEP = 1024;

export class QueueStore {
  private cache = new Map<string, unknown>();

  constructor(private readonly sql: SqlStorage) {}

  /** Creates/upgrades the schema. Version 0 = the Step 0 stub (meta with INTEGER values). */
  migrate(): void {
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)",
    );
    const row = this.sql
      .exec<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'schema_version'",
      )
      .toArray()[0];
    const version = row ? Number(JSON.parse(String(row.value))) : 0;
    if (version >= SCHEMA_VERSION) return;

    if (version < 1) {
      // The Step 0 stub stored INTEGER values (only a ping counter): start fresh.
      this.sql.exec(`
        DROP TABLE IF EXISTS meta;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tokens (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          number INTEGER NOT NULL,
          series TEXT NOT NULL,
          cls TEXT NOT NULL,
          method TEXT NOT NULL,
          user_id TEXT,
          state TEXT NOT NULL,
          sort_key INTEGER NOT NULL,
          joined_at INTEGER NOT NULL,
          called_at INTEGER,
          counter INTEGER,
          grace_until INTEGER,
          served_at INTEGER,
          ended_at INTEGER,
          end_reason TEXT,
          payment_order_id TEXT UNIQUE,
          alert_flags INTEGER NOT NULL DEFAULT 0,
          rev INTEGER NOT NULL DEFAULT 1,
          grace_ms INTEGER NOT NULL,
          cancel_window_ms INTEGER NOT NULL,
          eta_low_at_join INTEGER,
          eta_high_at_join INTEGER
        );
        CREATE INDEX IF NOT EXISTS tokens_state_sort_idx ON tokens (state, sort_key);
        CREATE INDEX IF NOT EXISTS tokens_user_state_idx ON tokens (user_id, state);
        CREATE INDEX IF NOT EXISTS tokens_grace_idx ON tokens (state, grace_until);
        CREATE TABLE IF NOT EXISTS intervals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS outbox_next_idx ON outbox (next_attempt_at);
        CREATE TABLE IF NOT EXISTS hourly (
          hour_start INTEGER PRIMARY KEY,
          joins INTEGER NOT NULL DEFAULT 0,
          leaves INTEGER NOT NULL DEFAULT 0,
          served INTEGER NOT NULL DEFAULT 0,
          no_shows INTEGER NOT NULL DEFAULT 0,
          cancels INTEGER NOT NULL DEFAULT 0,
          sum_wait_ms INTEGER NOT NULL DEFAULT 0,
          waits INTEGER NOT NULL DEFAULT 0,
          sum_interval_ms INTEGER NOT NULL DEFAULT 0,
          intervals INTEGER NOT NULL DEFAULT 0,
          eta_hits INTEGER NOT NULL DEFAULT 0,
          eta_total INTEGER NOT NULL DEFAULT 0
        );
      `);
    }
    this.cache.clear();
    this.set("schema_version", SCHEMA_VERSION);
  }

  // ---------- meta ----------

  get<K extends keyof Meta>(key: K): Meta[K] {
    if (this.cache.has(key)) return this.cache.get(key) as Meta[K];
    const row = this.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)
      .toArray()[0];
    const value = row
      ? (JSON.parse(String(row.value)) as Meta[K])
      : structuredClone(META_DEFAULTS[key]);
    this.cache.set(key, value);
    return value;
  }

  set<K extends keyof Meta>(key: K, value: Meta[K]): void {
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      JSON.stringify(value),
    );
    this.cache.set(key, value);
  }

  /** Drops cached meta (after a rolled-back transaction). */
  invalidate(): void {
    this.cache.clear();
  }

  // ---------- tokens ----------

  token(id: string): TokenRow | null {
    return (
      this.sql
        .exec<TokenRow>("SELECT * FROM tokens WHERE id = ?", id)
        .toArray()[0] ?? null
    );
  }

  tokenByPaymentOrder(paymentOrderId: string): TokenRow | null {
    return (
      this.sql
        .exec<TokenRow>(
          "SELECT * FROM tokens WHERE payment_order_id = ?",
          paymentOrderId,
        )
        .toArray()[0] ?? null
    );
  }

  insertToken(t: TokenRow): void {
    this.sql.exec(
      `INSERT INTO tokens (id, session_id, number, series, cls, method, user_id, state, sort_key,
        joined_at, called_at, counter, grace_until, served_at, ended_at, end_reason,
        payment_order_id, alert_flags, rev, grace_ms, cancel_window_ms, eta_low_at_join, eta_high_at_join)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      t.id,
      t.session_id,
      t.number,
      t.series,
      t.cls,
      t.method,
      t.user_id,
      t.state,
      t.sort_key,
      t.joined_at,
      t.called_at,
      t.counter,
      t.grace_until,
      t.served_at,
      t.ended_at,
      t.end_reason,
      t.payment_order_id,
      t.alert_flags,
      t.rev,
      t.grace_ms,
      t.cancel_window_ms,
      t.eta_low_at_join,
      t.eta_high_at_join,
    );
  }

  /** Updates the given columns and bumps `rev`. Returns the new row. */
  updateToken(
    id: string,
    patch: Partial<Omit<TokenRow, "id" | "rev">>,
  ): TokenRow {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    const sets = keys.map((k) => `${k} = ?`);
    sets.push("rev = rev + 1");
    this.sql.exec(
      `UPDATE tokens SET ${sets.join(", ")} WHERE id = ?`,
      ...keys.map((k) => patch[k] ?? null),
      id,
    );
    const row = this.token(id);
    if (!row) throw new Error(`token ${id} vanished`);
    return row;
  }

  /** Sets alert bits without bumping `rev` (not part of the durable record). */
  setAlertFlags(id: string, flags: number): void {
    this.sql.exec("UPDATE tokens SET alert_flags = ? WHERE id = ?", flags, id);
  }

  activeForUser(userId: string): TokenRow[] {
    return this.sql
      .exec<TokenRow>(
        "SELECT * FROM tokens WHERE user_id = ? AND state IN ('WAITING','CALLED','GRACE')",
        userId,
      )
      .toArray();
  }

  /** Waiting tokens in queue order. */
  waiting(limit = 100_000): TokenRow[] {
    return this.sql
      .exec<TokenRow>(
        "SELECT * FROM tokens WHERE state = 'WAITING' ORDER BY sort_key LIMIT ?",
        limit,
      )
      .toArray();
  }

  /** Waiting tokens strictly after `sortKey`, in order. */
  waitingAfter(sortKey: number, limit: number): TokenRow[] {
    return this.sql
      .exec<TokenRow>(
        "SELECT * FROM tokens WHERE state = 'WAITING' AND sort_key > ? ORDER BY sort_key LIMIT ?",
        sortKey,
        limit,
      )
      .toArray();
  }

  byState(state: TokenState): TokenRow[] {
    return this.sql
      .exec<TokenRow>(
        "SELECT * FROM tokens WHERE state = ? ORDER BY sort_key",
        state,
      )
      .toArray();
  }

  active(): TokenRow[] {
    return this.sql
      .exec<TokenRow>(
        "SELECT * FROM tokens WHERE state IN ('WAITING','CALLED','GRACE') ORDER BY sort_key",
      )
      .toArray();
  }

  /** QUE-03: people ahead = waiting tokens with a smaller sort key (index on state, sort_key). */
  peopleAhead(sortKey: number): number {
    return this.count(
      "SELECT COUNT(*) AS n FROM tokens WHERE state = 'WAITING' AND sort_key < ?",
      sortKey,
    );
  }

  countState(state: TokenState): number {
    return this.count(
      "SELECT COUNT(*) AS n FROM tokens WHERE state = ?",
      state,
    );
  }

  countActive(): number {
    return this.count(
      "SELECT COUNT(*) AS n FROM tokens WHERE state IN ('WAITING','CALLED','GRACE')",
    );
  }

  countWaitingRemote(): number {
    return this.count(
      "SELECT COUNT(*) AS n FROM tokens WHERE state = 'WAITING' AND method = 'remote'",
    );
  }

  maxWaitingSortKey(): number | null {
    const row = this.sql
      .exec<{ k: number | null }>(
        "SELECT MAX(sort_key) AS k FROM tokens WHERE state = 'WAITING'",
      )
      .one();
    return row.k ?? null;
  }

  sortKeyTaken(key: number): boolean {
    return (
      this.count(
        "SELECT COUNT(*) AS n FROM tokens WHERE state = 'WAITING' AND sort_key = ?",
        key,
      ) > 0
    );
  }

  /** Earliest grace expiry among GRACE tokens. */
  nextGraceExpiry(): number | null {
    const row = this.sql
      .exec<{ t: number | null }>(
        "SELECT MIN(grace_until) AS t FROM tokens WHERE state = 'GRACE'",
      )
      .one();
    return row.t ?? null;
  }

  graceDue(now: number): TokenRow[] {
    return this.sql
      .exec<TokenRow>(
        "SELECT * FROM tokens WHERE state = 'GRACE' AND grace_until <= ? ORDER BY grace_until",
        now,
      )
      .toArray();
  }

  /** Removes finished tokens of earlier sessions (D1 holds their history). */
  pruneOldSessions(currentSession: string): void {
    this.sql.exec(
      "DELETE FROM tokens WHERE session_id <> ? AND state NOT IN ('WAITING','CALLED','GRACE')",
      currentSession,
    );
  }

  /** Renumbers waiting tokens' sort keys, keeping order and class rank. */
  renumberWaiting(): void {
    const rows = this.waiting();
    let seq = this.get("seq");
    for (const r of rows) {
      seq += 1;
      const rank = Math.floor(r.sort_key / RANK_SPAN);
      this.sql.exec(
        "UPDATE tokens SET sort_key = ? WHERE id = ?",
        rank * RANK_SPAN + seq * SEQ_STEP,
        r.id,
      );
    }
    this.set("seq", seq);
  }

  // ---------- intervals ----------

  recentIntervals(limit: number): number[] {
    return this.sql
      .exec<{ ms: number }>(
        "SELECT ms FROM intervals ORDER BY id DESC LIMIT ?",
        limit,
      )
      .toArray()
      .map((r) => r.ms)
      .reverse();
  }

  addInterval(ms: number, keep: number): number {
    const row = this.sql
      .exec<{ id: number }>(
        "INSERT INTO intervals (ms) VALUES (?) RETURNING id",
        ms,
      )
      .one();
    this.sql.exec(
      "DELETE FROM intervals WHERE id <= (SELECT MAX(id) FROM intervals) - ?",
      keep,
    );
    return row.id;
  }

  removeInterval(id: number): void {
    this.sql.exec("DELETE FROM intervals WHERE id = ?", id);
  }

  // ---------- outbox ----------

  enqueue(kind: OutboxKind, payload: unknown, now: number): string {
    const id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO outbox (id, kind, payload, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, 0, ?, ?)",
      id,
      kind,
      JSON.stringify(payload),
      now,
      now,
    );
    return id;
  }

  dueOutbox(now: number, limit: number): OutboxRow[] {
    return this.sql
      .exec<OutboxRow>(
        "SELECT * FROM outbox WHERE next_attempt_at <= ? ORDER BY created_at, rowid LIMIT ?",
        now,
        limit,
      )
      .toArray();
  }

  nextOutboxAttempt(): number | null {
    const row = this.sql
      .exec<{ t: number | null }>(
        "SELECT MIN(next_attempt_at) AS t FROM outbox",
      )
      .one();
    return row.t ?? null;
  }

  outboxCount(): number {
    return this.count("SELECT COUNT(*) AS n FROM outbox");
  }

  deleteOutbox(id: string): void {
    this.sql.exec("DELETE FROM outbox WHERE id = ?", id);
  }

  retryOutbox(id: string, attempts: number, nextAt: number): void {
    this.sql.exec(
      "UPDATE outbox SET attempts = ?, next_attempt_at = ? WHERE id = ?",
      attempts,
      nextAt,
      id,
    );
  }

  // ---------- hourly analytics ----------

  bump(hourStart: number, delta: Partial<HourlyCounts>): void {
    const keys = (Object.keys(delta) as HourlyField[]).filter(
      (k) => (delta[k] ?? 0) !== 0,
    );
    if (keys.length === 0) return;
    this.sql.exec(
      "INSERT INTO hourly (hour_start) VALUES (?) ON CONFLICT(hour_start) DO NOTHING",
      hourStart,
    );
    this.sql.exec(
      `UPDATE hourly SET ${keys.map((k) => `${k} = ${k} + ?`).join(", ")} WHERE hour_start = ?`,
      ...keys.map((k) => delta[k] ?? 0),
      hourStart,
    );
  }

  hourlyRows(beforeHour?: number): HourlyRow[] {
    return beforeHour === undefined
      ? this.sql
          .exec<HourlyRow>("SELECT * FROM hourly ORDER BY hour_start")
          .toArray()
      : this.sql
          .exec<HourlyRow>(
            "SELECT * FROM hourly WHERE hour_start < ? ORDER BY hour_start",
            beforeHour,
          )
          .toArray();
  }

  earliestHour(): number | null {
    const row = this.sql
      .exec<{ h: number | null }>("SELECT MIN(hour_start) AS h FROM hourly")
      .one();
    return row.h ?? null;
  }

  deleteHour(hourStart: number): void {
    this.sql.exec("DELETE FROM hourly WHERE hour_start = ?", hourStart);
  }

  private count(query: string, ...binds: SqlStorageValue[]): number {
    return Number(this.sql.exec<{ n: number }>(query, ...binds).one().n);
  }
}
