import {
  DEMO_BUSINESS_SHARE_PCT,
  type DemoHistoryBody,
  type DemoHistoryResponse,
  type DemoQueue,
  type DemoQueueProfile,
  type DemoResetResponse,
  type DemoSeedBody,
  type DemoSeedResponse,
  generateDemoHistory,
  QueueSettings,
} from "@qpeer/shared";
import { and, eq, inArray, like } from "drizzle-orm";
import type { Db } from "../../db/client";
import { businesses, businessMembers, queues, users } from "../../db/schema";
import type { Bindings } from "../../env";
import { notFound } from "../../lib/errors";
import { geohash } from "../../lib/geo";
import { DAY_MS } from "../../lib/time";
import { DEMO_UID_PREFIX } from "../../middleware/demo-auth";
import { initQueueDO } from "../business/service";
import { queueStub } from "../queue/do-client";
import {
  DEMO_BUSINESS_PREFIX,
  DEMO_CATALOG,
  DEMO_CUSTOMER_ID,
  DEMO_QUEUE_PREFIX,
  demoBusinessId,
  demoPaymentPrefix,
  demoQueueId,
} from "./catalog";

/**
 * Demo tools (Step 5, DEM-01…06; architecture doc §19.2). Only reachable
 * through `demo/routes.ts` (demo-key callers on demo/dev/local). Every write
 * is scoped by the fixed `de30000x-` ids or the `demo:` uid prefix, so a
 * reset on `dev` never touches anything a real user made.
 *
 * Per-request limits (free plan): each request runs a handful of D1
 * statements, so the scripts call seed and history once per business.
 */

type Env = Pick<Bindings, "DB" | "QUEUE">;

export interface DemoCtx {
  db: Db;
  env: Env;
  now: number;
}

/** Queues closed per reset request (subrequest limit, like the load test). */
export const MAX_RESET_QUEUES = 40;
/** Largest SQL text per bulk INSERT (D1 allows 100 KB). */
const MAX_SQL_CHARS = 90_000;

function spec(index: number) {
  const s = DEMO_CATALOG[index - 1];
  if (!s) throw notFound();
  return s;
}

function settingsFor(priority: boolean): QueueSettings {
  return QueueSettings.parse(
    priority ? { priorityEnabled: true, priorityPerRegular: 2 } : {},
  );
}

function demoQueueView(
  index: number,
  q: { id: string; name: string; settings: QueueSettings },
): DemoQueue {
  const s = spec(index);
  return {
    id: q.id,
    name: q.name,
    businessId: demoBusinessId(index),
    businessName: s.name,
    businessIndex: index,
    lat: s.lat,
    lng: s.lng,
    priorityEnabled: q.settings.priorityEnabled,
  };
}

/**
 * DEM-01: one business of the catalogue, its queues (DO initialised, not
 * opened) and its owners: the caller (the demo owner) and any registered
 * accounts with the given phone numbers. Idempotent (fixed ids).
 */
export async function seedDemoBusiness(
  { db, env, now }: DemoCtx,
  callerId: string,
  body: DemoSeedBody,
): Promise<DemoSeedResponse> {
  const s = spec(body.businessIndex);
  const id = demoBusinessId(body.businessIndex);
  const at = new Date(now);
  const inserted = await db
    .insert(businesses)
    .values({
      id,
      ownerUserId: callerId,
      name: s.name,
      category: s.category,
      address: `${s.area}, Jammu`,
      phone: null,
      lat: s.lat,
      lng: s.lng,
      geohash: geohash({ lat: s.lat, lng: s.lng }),
      hoursJson: s.hours,
      status: "active",
      publicStats: true,
      // Listed long ago, so public stats show (MAP-06).
      firstListedAt: new Date(now - 60 * DAY_MS),
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing()
    .returning({ id: businesses.id });

  const found =
    body.ownerPhones.length === 0
      ? []
      : await db
          .select({ id: users.id, phone: users.phone })
          .from(users)
          .where(
            and(
              inArray(users.phone, body.ownerPhones),
              eq(users.isAnonymous, false),
            ),
          )
          .all();
  const memberIds = [callerId, ...found.map((u) => u.id)];
  await db
    .insert(businessMembers)
    .values(
      memberIds.map((userId) => ({
        businessId: id,
        userId,
        role: "owner" as const,
        createdAt: at,
        updatedAt: at,
      })),
    )
    .onConflictDoNothing();

  const out: DemoQueue[] = [];
  for (const [j, qs] of s.queues.entries()) {
    const qid = demoQueueId(body.businessIndex, j + 1);
    const settings = settingsFor(qs.priority);
    const row = {
      id: qid,
      businessId: id,
      name: qs.name,
      status: "active" as const,
      settingsJson: settings,
      settingsVersion: 1,
      createdAt: at,
      updatedAt: at,
    };
    await db.insert(queues).values(row).onConflictDoNothing();
    await initQueueDO(db, env, { ...row, settingsJson: settings });
    out.push(
      demoQueueView(body.businessIndex, {
        id: qid,
        name: qs.name,
        settings,
      }),
    );
  }
  const foundPhones = new Set(found.map((u) => u.phone));
  return {
    catalogSize: DEMO_CATALOG.length,
    businessId: id,
    businessName: s.name,
    created: inserted.length > 0,
    queues: out,
    ownersAdded: body.ownerPhones.filter((p) => foundPhones.has(p)),
    ownersMissing: body.ownerPhones.filter((p) => !foundPhones.has(p)),
  };
}

/** GET /v1/demo/queues: the seeded active queues, in catalogue order. */
export async function listDemoQueues(db: Db): Promise<DemoQueue[]> {
  const rows = await db
    .select({ id: queues.id, name: queues.name, settings: queues.settingsJson })
    .from(queues)
    .where(
      and(
        eq(queues.status, "active"),
        like(queues.id, `${DEMO_QUEUE_PREFIX}%`),
      ),
    )
    .all();
  const out: DemoQueue[] = [];
  for (const [i0, s] of DEMO_CATALOG.entries()) {
    const index = i0 + 1;
    s.queues.forEach((_, j) => {
      const r = rows.find((x) => x.id === demoQueueId(index, j + 1));
      if (!r) return;
      out.push(
        demoQueueView(index, {
          id: r.id,
          name: r.name,
          settings: QueueSettings.parse(r.settings),
        }),
      );
    });
  }
  return out;
}

// ---------- history (DEM-02, DEM-03) ----------

/** A value for literal SQL: safe integers and plain id-like text only. */
function lit(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error(`demo seed: bad number ${v}`);
    return String(v);
  }
  if (!/^[A-Za-z0-9:_.-]*$/.test(v)) {
    throw new Error("demo seed: unexpected characters in a value");
  }
  return `'${v}'`;
}

/**
 * Multi-row INSERTs with literal values (all generated here, checked by
 * `lit`), split so each statement stays under D1's SQL size limit. Bound
 * parameters would allow only ~6 rows per statement.
 */
function bulkInserts(
  d1: D1Database,
  table: string,
  columns: string[],
  rows: (string | number | null)[][],
): D1PreparedStatement[] {
  const head = `INSERT INTO ${table} (${columns.join(", ")}) VALUES `;
  const out: D1PreparedStatement[] = [];
  let parts: string[] = [];
  let size = head.length;
  for (const r of rows) {
    const t = `(${r.map(lit).join(", ")})`;
    if (parts.length > 0 && size + t.length + 1 > MAX_SQL_CHARS) {
      out.push(d1.prepare(head + parts.join(",")));
      parts = [];
      size = head.length;
    }
    parts.push(t);
    size += t.length + 1;
  }
  if (parts.length > 0) out.push(d1.prepare(head + parts.join(",")));
  return out;
}

/**
 * Replaces one demo business's synthetic history: `weeks` of
 * `analytics_hourly`, past payments and their ledger rows, all before the
 * current hour. One D1 batch (one transaction): delete, then insert.
 */
export async function seedDemoHistory(
  { db, env, now }: DemoCtx,
  body: DemoHistoryBody,
): Promise<DemoHistoryResponse> {
  const s = spec(body.businessIndex);
  const businessId = demoBusinessId(body.businessIndex);
  const exists = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .get();
  if (!exists) throw notFound();

  const profiles: DemoQueueProfile[] = s.queues.map((qs, j) => {
    const settings = settingsFor(qs.priority);
    return {
      queueId: demoQueueId(body.businessIndex, j + 1),
      businessId,
      category: s.category,
      hours: s.hours,
      baseJoinsPerHour: qs.baseJoinsPerHour,
      serviceMin: qs.serviceMin,
      reservationFeePaise: settings.reservationFeePaise,
      priorityFeePaise: settings.priorityEnabled
        ? settings.priorityFeePaise
        : null,
      priorityCancelRefundPct: settings.priorityCancelRefundPct,
    };
  });
  const h = generateDemoHistory(profiles, {
    now,
    weeks: body.weeks,
    seed: body.seed,
    businessSharePct: DEMO_BUSINESS_SHARE_PCT,
    paymentIdPrefix: demoPaymentPrefix(body.businessIndex),
    customerUserId: DEMO_CUSTOMER_ID,
  });

  const d1 = env.DB;
  const statements: D1PreparedStatement[] = [
    d1
      .prepare("DELETE FROM ledger_entries WHERE business_id = ?")
      .bind(businessId),
    d1.prepare("DELETE FROM payments WHERE business_id = ?").bind(businessId),
    d1
      .prepare("DELETE FROM analytics_hourly WHERE business_id = ?")
      .bind(businessId),
    ...bulkInserts(
      d1,
      "analytics_hourly",
      [
        "queue_id",
        "business_id",
        "hour_start",
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
        "created_at",
        "updated_at",
      ],
      h.analytics.map((r) => [
        r.queueId,
        r.businessId,
        r.hourStart,
        r.joins,
        r.leaves,
        r.served,
        r.noShows,
        r.cancels,
        r.sumWaitMs,
        r.waits,
        r.sumIntervalMs,
        r.intervals,
        r.etaHits,
        r.etaTotal,
        now,
        now,
      ]),
    ),
    ...bulkInserts(
      d1,
      "payments",
      [
        "id",
        "user_id",
        "queue_id",
        "business_id",
        "token_id",
        "kind",
        "amount_paise",
        "business_share_pct",
        "device_hash",
        "razorpay_order_id",
        "razorpay_payment_id",
        "status",
        "refund_id",
        "refund_paise",
        "refund_status",
        "reason",
        "refund_attempts",
        "refund_retry_at",
        "expires_at",
        "created_at",
        "updated_at",
      ],
      h.payments.map((p) => [
        p.id,
        p.userId,
        p.queueId,
        p.businessId,
        null,
        p.kind,
        p.amountPaise,
        p.businessSharePct,
        null,
        p.razorpayOrderId,
        p.razorpayPaymentId,
        p.status,
        p.refundId,
        p.refundPaise,
        p.refundStatus,
        p.reason,
        0,
        null,
        p.expiresAt,
        p.createdAt,
        p.updatedAt,
      ]),
    ),
    ...bulkInserts(
      d1,
      "ledger_entries",
      [
        "id",
        "payment_id",
        "business_id",
        "kind",
        "amount_paise",
        "at",
        "created_at",
      ],
      h.ledger.map((l) => [
        l.id,
        l.paymentId,
        l.businessId,
        l.kind,
        l.amountPaise,
        l.at,
        l.at,
      ]),
    ),
  ];
  await d1.batch(statements);
  return {
    businessId,
    analyticsRows: h.analytics.length,
    payments: h.payments.length,
    ledgerRows: h.ledger.length,
  };
}

// ---------- reset (DEM-05) ----------

const BIZ_LIKE = `${DEMO_BUSINESS_PREFIX}%`;
const SIM_USERS = `(SELECT id FROM users WHERE firebase_uid LIKE '${DEMO_UID_PREFIX}%')`;

/** Demo rows only (seeded businesses and everything under them, simulated users). */
function scopedDeletes(d1: D1Database): [string, D1PreparedStatement][] {
  const biz = (table: string, col = "business_id") =>
    [
      table,
      d1.prepare(`DELETE FROM ${table} WHERE ${col} LIKE ?`).bind(BIZ_LIKE),
    ] as [string, D1PreparedStatement];
  return [
    biz("ledger_entries"),
    biz("payments"),
    biz("analytics_hourly"),
    biz("queue_snapshots"),
    [
      "push_tickets",
      d1
        .prepare(
          "DELETE FROM push_tickets WHERE token_id IN (SELECT id FROM tokens WHERE business_id LIKE ?)",
        )
        .bind(BIZ_LIKE),
    ],
    biz("tokens"),
    [
      "free_lane_strikes",
      d1.prepare(`DELETE FROM free_lane_strikes WHERE user_id IN ${SIM_USERS}`),
    ],
    [
      "devices",
      d1.prepare(`DELETE FROM devices WHERE user_id IN ${SIM_USERS}`),
    ],
    biz("business_members"),
    biz("queues"),
    biz("businesses", "id"),
  ];
}

/** `wipeAll` (demo/local): every business, ticket and payment row; accounts stay. */
const WIPE_ALL_TABLES = [
  "ledger_entries",
  "payments",
  "webhook_events",
  "push_tickets",
  "free_lane_strikes",
  "outbox_receipts",
  "analytics_hourly",
  "queue_snapshots",
  "tokens",
  "business_members",
  "queues",
  "businesses",
] as const;

/**
 * DEM-05: closes the queues (their DOs flush the last token rows), then once
 * every outbox is empty deletes the demo rows — or, with `wipeAll`, every
 * business/ticket/payment row. Simulated `demo:` users that own or staff
 * nothing are deleted too. While outboxes drain: `done: false` (409), retry.
 */
export async function resetDemo(
  env: Env,
  wipeAll: boolean,
): Promise<DemoResetResponse> {
  const d1 = env.DB;
  const { results } = await d1
    .prepare(
      wipeAll
        ? "SELECT id FROM queues ORDER BY id LIMIT ?"
        : "SELECT id FROM queues WHERE id LIKE ? ORDER BY id LIMIT ?",
    )
    .bind(...(wipeAll ? [] : [`${DEMO_QUEUE_PREFIX}%`]), MAX_RESET_QUEUES + 1)
    .all<{ id: string }>();
  const batch = results.slice(0, MAX_RESET_QUEUES);
  const pending = await Promise.all(
    batch.map(async ({ id }) => {
      const stub = queueStub(env, id);
      try {
        await stub.close(); // an already-closed queue just answers an error
      } catch {
        // a queue whose DO was never set up: nothing to close
      }
      return stub.flushOutbox();
    }),
  );
  const pendingOutbox = pending.reduce((a, b) => a + b, 0);
  // A wipe of more queues than one request may close: delete the closed ones' rows and go again.
  if (pendingOutbox > 0) {
    return {
      done: false,
      closedQueues: batch.length,
      pendingOutbox,
      deleted: {},
    };
  }
  if (wipeAll && results.length > MAX_RESET_QUEUES) {
    const ids = batch.map((r) => r.id);
    await d1.batch([
      d1
        .prepare(
          `DELETE FROM queues WHERE id IN (${ids.map(() => "?").join(", ")})`,
        )
        .bind(...ids),
    ]);
    return {
      done: false,
      closedQueues: batch.length,
      pendingOutbox: 0,
      deleted: {},
    };
  }
  const steps: [string, D1PreparedStatement][] = wipeAll
    ? WIPE_ALL_TABLES.map((t) => [t, d1.prepare(`DELETE FROM ${t}`)])
    : scopedDeletes(d1);
  steps.push([
    "users",
    d1.prepare(
      `DELETE FROM users WHERE firebase_uid LIKE '${DEMO_UID_PREFIX}%'
         AND id NOT IN (SELECT user_id FROM business_members)
         AND id NOT IN (SELECT owner_user_id FROM businesses)`,
    ),
  ]);
  const res = await d1.batch(steps.map(([, s]) => s));
  const deleted: Record<string, number> = {};
  steps.forEach(([t], i) => {
    deleted[t] = (deleted[t] ?? 0) + (res[i]?.meta.changes ?? 0);
  });
  return { done: true, closedQueues: batch.length, pendingOutbox: 0, deleted };
}

/** True for a seeded queue id (the priority-pass helper only works on those). */
export const isDemoQueue = (id: string) => id.startsWith(DEMO_QUEUE_PREFIX);
