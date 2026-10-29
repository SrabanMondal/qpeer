import type { QueueSettings, WeeklyHours } from "@qpeer/shared";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/*
 * Time convention: every timestamp column is INTEGER epoch milliseconds, declared
 * with `mode: "timestamp_ms"` (Drizzle maps it to a JS Date). API JSON exposes the
 * same instant as a number of epoch ms (`date.getTime()`). Never use `mode:
 * "timestamp"` (seconds). See docs/QPeer_v1_Backend_Architecture.md section 4.
 */
const ms = (name: string) => integer(name, { mode: "timestamp_ms" });

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull().unique(),
  isAnonymous: integer("is_anonymous", { mode: "boolean" }).notNull(),
  phone: text("phone"),
  email: text("email"),
  displayName: text("display_name"),
  /** Last mode chosen in the app (IDN-08); null = never chosen (app shows Customer). */
  preferredMode: text("preferred_mode", { enum: ["customer", "business"] }),
  /** Unused until Step 2 (free-lane no-show blocking). */
  freeLaneBlockedUntil: ms("free_lane_blocked_until"),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const businesses = sqliteTable(
  "businesses",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    name: text("name").notNull(),
    category: text("category", {
      enum: ["clinic", "lab", "service_centre", "salon", "other"],
    }).notNull(),
    address: text("address").notNull(),
    phone: text("phone"),
    /** Null until the owner sets the pin (BIZ-03). */
    lat: real("lat"),
    lng: real("lng"),
    geohash: text("geohash"),
    hoursJson: text("hours_json", { mode: "json" })
      .$type<WeeklyHours>()
      .notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    /** MAP-06: owner opt-in to show public stats before 14 days of listing. */
    publicStats: integer("public_stats", { mode: "boolean" })
      .notNull()
      .default(false),
    /**
     * First time the business became listed (BIZ-07); never cleared, so a short
     * deactivation doesn't restart the MAP-06 14-day clock. Null = never listed.
     */
    firstListedAt: ms("first_listed_at"),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    index("businesses_status_lat_lng_idx").on(t.status, t.lat, t.lng),
    index("businesses_owner_user_id_idx").on(t.ownerUserId),
  ],
);

export type Business = typeof businesses.$inferSelect;

export const businessMembers = sqliteTable(
  "business_members",
  {
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["owner", "staff"] }).notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.businessId, t.userId] }),
    index("business_members_user_id_idx").on(t.userId),
  ],
);

export type BusinessMember = typeof businessMembers.$inferSelect;

export const queues = sqliteTable(
  "queues",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "archived"] }).notNull(),
    settingsJson: text("settings_json", { mode: "json" })
      .$type<QueueSettings>()
      .notNull(),
    /** Incremented on every settings change; the QueueDO ignores older versions. */
    settingsVersion: integer("settings_version").notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [index("queues_business_id_idx").on(t.businessId)],
);

export type Queue = typeof queues.$inferSelect;

// ---------- Step 2: live queue records (written by the QueueDO outbox) ----------

/**
 * Map snapshot per queue (QUE-18). Written by the QueueDO through its outbox;
 * `lat`/`lng` are copied from the business at write time (and when the pin
 * moves). `eta_low_ms`/`eta_high_ms` are wait **durations** for a new joiner.
 */
export const queueSnapshots = sqliteTable(
  "queue_snapshots",
  {
    queueId: text("queue_id").primaryKey(),
    businessId: text("business_id").notNull(),
    lat: real("lat"),
    lng: real("lng"),
    isOpen: integer("is_open", { mode: "boolean" }).notNull(),
    isPaused: integer("is_paused", { mode: "boolean" }).notNull(),
    waiting: integer("waiting").notNull(),
    etaLowMs: integer("eta_low_ms"),
    etaHighMs: integer("eta_high_ms"),
    /** Label of the token at the counter or served last (`47`, `T2`), or null. */
    nowServing: text("now_serving"),
    /** Tokens at a counter (CALLED) at snapshot time (B19). */
    inService: integer("in_service").notNull().default(0),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [index("queue_snapshots_lat_lng_idx").on(t.lat, t.lng)],
);

export type QueueSnapshot = typeof queueSnapshots.$inferSelect;

export const TOKEN_STATES = [
  "BOOKED",
  "WAITING",
  "CALLED",
  "GRACE",
  "MISSED",
  "SERVED",
  "EXPIRED",
  "LEFT",
  "CANCELLED",
] as const;

/**
 * Durable token record (QUE-19, TOK-06). The QueueDO owns the live state; this
 * row is upserted by its outbox, guarded by `rev` (a per-token revision that
 * only goes up) so a late retry can never move a token backwards.
 */
export const tokens = sqliteTable(
  "tokens",
  {
    id: text("id").primaryKey(),
    queueId: text("queue_id").notNull(),
    sessionId: text("session_id").notNull(),
    businessId: text("business_id").notNull(),
    /** Null for staff-inserted triage tokens. */
    userId: text("user_id"),
    number: integer("number").notNull(),
    series: text("series", { enum: ["R", "P", "T"] }).notNull(),
    class: text("class", { enum: ["triage", "priority", "regular"] }).notNull(),
    method: text("method", { enum: ["walkin", "remote", "staff"] }).notNull(),
    state: text("state", { enum: TOKEN_STATES }).notNull(),
    joinedAt: ms("joined_at").notNull(),
    calledAt: ms("called_at"),
    servedAt: ms("served_at"),
    endedAt: ms("ended_at"),
    endReason: text("end_reason", {
      enum: ["served", "no_show", "left", "cancelled", "closed", "validity"],
    }),
    paymentId: text("payment_id"),
    rev: integer("rev").notNull(),
    /** C2: SHA-256 of ANDROID_ID + app salt (walk-ins); never the raw id. */
    deviceHash: text("device_hash"),
    /** C4: end of the ticket's validity; null = until the queue closes. BOOKED: end of the pass window. */
    expiresAt: ms("expires_at"),
    /** R2 (Step 4): 4-character check code given at allocation. */
    checkCode: text("check_code"),
    /** Step 4: Priority Pass check-in (or upgrade) time. */
    checkedInAt: ms("checked_in_at"),
    /** Step 4: when grace ended (MISSED). */
    missedAt: ms("missed_at"),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    index("tokens_user_id_state_idx").on(t.userId, t.state),
    index("tokens_queue_id_session_id_idx").on(t.queueId, t.sessionId),
    // BOOKED passes have no session or number yet (session_id ''), so the
    // uniqueness only covers numbered tokens (Step 4).
    uniqueIndex("tokens_queue_session_series_number_uq")
      .on(t.queueId, t.sessionId, t.series, t.number)
      .where(sql`session_id <> ''`),
  ],
);

export type TokenRow = typeof tokens.$inferSelect;

/** Expo push tokens per user (ALR-02). */
export const devices = sqliteTable(
  "devices",
  {
    expoPushToken: text("expo_push_token").primaryKey(),
    userId: text("user_id").notNull(),
    platform: text("platform", { enum: ["android", "ios"] }).notNull(),
    /** C2: device hash sent at registration (optional). */
    deviceHash: text("device_hash"),
    lastSeenAt: ms("last_seen_at").notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [index("devices_user_id_idx").on(t.userId)],
);

/** Expo push tickets; the hourly cron checks their receipts. */
export const pushTickets = sqliteTable(
  "push_tickets",
  {
    /** Expo ticket id. */
    id: text("id").primaryKey(),
    tokenId: text("token_id").notNull(),
    /** Device the ticket was sent to (to prune it on `DeviceNotRegistered`). */
    expoPushToken: text("expo_push_token").notNull(),
    kind: text("kind").notNull(),
    sentAt: ms("sent_at").notNull(),
    receiptCheckedAt: ms("receipt_checked_at"),
    /** `sent` until the receipt is checked, then `ok` or the Expo error code. */
    status: text("status").notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [index("push_tickets_receipt_checked_at_idx").on(t.receiptCheckedAt)],
);

/** One row per free-lane no-show (JON-07); id = the outbox item id (idempotent). */
export const freeLaneStrikes = sqliteTable(
  "free_lane_strikes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenId: text("token_id").notNull(),
    /** C2: the no-show's device hash; strikes also count per device. */
    deviceHash: text("device_hash"),
    at: ms("at").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [
    index("free_lane_strikes_user_id_at_idx").on(t.userId, t.at),
    index("free_lane_strikes_device_hash_at_idx").on(t.deviceHash, t.at),
  ],
);

/** Hourly counters per queue (QUE-19), additive upserts from the QueueDO outbox. */
export const analyticsHourly = sqliteTable(
  "analytics_hourly",
  {
    queueId: text("queue_id").notNull(),
    businessId: text("business_id").notNull(),
    /** Start of the IST hour, epoch ms. */
    hourStart: integer("hour_start").notNull(),
    joins: integer("joins").notNull().default(0),
    leaves: integer("leaves").notNull().default(0),
    served: integer("served").notNull().default(0),
    noShows: integer("no_shows").notNull().default(0),
    cancels: integer("cancels").notNull().default(0),
    sumWaitMs: integer("sum_wait_ms").notNull().default(0),
    waits: integer("waits").notNull().default(0),
    sumIntervalMs: integer("sum_interval_ms").notNull().default(0),
    intervals: integer("intervals").notNull().default(0),
    etaHits: integer("eta_hits").notNull().default(0),
    etaTotal: integer("eta_total").notNull().default(0),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.queueId, t.hourStart] }),
    index("analytics_hourly_business_id_hour_start_idx").on(
      t.businessId,
      t.hourStart,
    ),
  ],
);

/**
 * Outbox items already applied to D1 (dedupe for the additive analytics upsert,
 * §9.8 "outbox id stored in the batch"). Inserted in the same batch as the
 * upsert; a duplicate id fails the whole batch, which means "already applied".
 */
export const outboxReceipts = sqliteTable("outbox_receipts", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  appliedAt: ms("applied_at").notNull(),
});

// ---------- Step 4: payments (Razorpay test mode, architecture doc §10) ----------

export const PAYMENT_STATUSES = [
  "created",
  "captured",
  "allocated",
  "refund_due",
  "refunded",
  "forfeited",
  "failed",
  "expired",
] as const;

/**
 * One Razorpay order and what became of it. `id` is our payment id (also the
 * order's receipt). Status transitions are guarded in SQL so the client
 * verify, the webhook and the cron can run in any order.
 */
export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    queueId: text("queue_id").notNull(),
    businessId: text("business_id").notNull(),
    /** Set once a token exists (reservation, pass) or for the upgraded token. */
    tokenId: text("token_id"),
    kind: text("kind", {
      enum: ["reservation", "priority", "upgrade"],
    }).notNull(),
    amountPaise: integer("amount_paise").notNull(),
    /** Business share at purchase time (demo constant 70). */
    businessSharePct: integer("business_share_pct").notNull(),
    /** PRI-11: device hash on pass purchases and upgrades. */
    deviceHash: text("device_hash"),
    razorpayOrderId: text("razorpay_order_id").notNull().unique(),
    razorpayPaymentId: text("razorpay_payment_id").unique(),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull(),
    refundId: text("refund_id"),
    refundPaise: integer("refund_paise"),
    refundStatus: text("refund_status", {
      enum: ["pending", "processed", "failed"],
    }),
    /**
     * Why a refund or failure happened (`closed`, `cancelled`, `quota_full`…).
     * `duplicate_payment` / `amount_mismatch` mark a stray row: a second
     * captured Razorpay payment on an order (or one of the wrong amount) that
     * buys nothing and is refunded in full. A stray row's `razorpay_order_id`
     * is `<order id>:<payment id>`, so the order's own row stays unique.
     */
    reason: text("reason"),
    /** Failed Razorpay refund attempts (alert after `REFUND_ALERT_AFTER`). */
    refundAttempts: integer("refund_attempts").notNull().default(0),
    /** No refund attempt before this time (backoff, and a short lease while one runs). */
    refundRetryAt: ms("refund_retry_at"),
    expiresAt: ms("expires_at").notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    index("payments_user_id_created_at_idx").on(t.userId, t.createdAt),
    index("payments_status_expires_at_idx").on(t.status, t.expiresAt),
    index("payments_queue_device_created_idx").on(
      t.queueId,
      t.deviceHash,
      t.createdAt,
    ),
    index("payments_queue_user_created_idx").on(
      t.queueId,
      t.userId,
      t.createdAt,
    ),
    index("payments_business_created_idx").on(t.businessId, t.createdAt),
    index("payments_token_id_idx").on(t.tokenId),
  ],
);

export type Payment = typeof payments.$inferSelect;

/** Append-only money ledger (§10.3). Ids are deterministic per event, so retries never double-write. */
export const ledgerEntries = sqliteTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id").notNull(),
    businessId: text("business_id").notNull(),
    kind: text("kind", {
      enum: [
        "capture",
        "refund",
        "forfeit",
        "business_share",
        "platform_share",
      ],
    }).notNull(),
    amountPaise: integer("amount_paise").notNull(),
    at: ms("at").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [
    index("ledger_entries_business_id_at_idx").on(t.businessId, t.at),
    index("ledger_entries_payment_id_idx").on(t.paymentId),
  ],
);

/** Razorpay webhook dedupe (event id). `processed_at` null = retry on redelivery. */
export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    receivedAt: ms("received_at").notNull(),
    processedAt: ms("processed_at"),
  },
  (t) => [index("webhook_events_received_at_idx").on(t.receivedAt)],
);
