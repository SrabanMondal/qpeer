import {
  type BusinessRole,
  type BusinessStats,
  type BusinessView,
  type CreateBusinessBody,
  type CreateQueueBody,
  isOpenAt,
  type ListingRequirement,
  priorityInfo,
  type QueueInfoResponse,
  type QueueLiveSummary,
  QueueSettings,
  type QueueView,
  queueJoinUrl,
  STATS_MIN_SAMPLES,
  STATS_PUBLIC_AFTER_DAYS,
  STATS_WINDOW_DAYS,
  todayHours,
  type UpdateBusinessBody,
  type UpdateQueueBody,
} from "@qpeer/shared";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  analyticsHourly,
  type Business,
  businesses,
  businessMembers,
  type Queue,
  type QueueSnapshot,
  queueSnapshots,
  queues,
} from "../../db/schema";
import type { Bindings } from "../../env";
import { AppError, notFound } from "../../lib/errors";
import { geohash } from "../../lib/geo";
import { newId } from "../../lib/ids";
import { DAY_MS, toMs } from "../../lib/time";
import { findRole } from "../../middleware/guards";
import type { PaidOutcome } from "../../queue/queue-do";
import { type PayEnv, refundOutcomes } from "../payments/service";
import { queueStub, unwrap } from "../queue/do-client";

export const MAX_ACTIVE_QUEUES = 10;

export interface ServiceCtx {
  db: Db;
  now: number;
  /** For QueueDO calls (init, settings, close, live summary) and refunds on close. */
  env: Pick<Bindings, "QUEUE"> & Partial<PayEnv>;
}

/** Refunds after the business cancels (deactivate, archive): Step 4, §10.5. */
async function refundAfterClose(
  { db, now, env }: ServiceCtx,
  outcomes: PaidOutcome[],
): Promise<void> {
  if (outcomes.length === 0 || !env.DB) return;
  await refundOutcomes({ db, now, env: env as PayEnv }, outcomes);
}

// ---------- views ----------

function queueView(
  q: Queue,
  role: BusinessRole | null,
  live?: QueueLiveSummary | null,
): QueueView {
  const view: QueueView = {
    id: q.id,
    businessId: q.businessId,
    name: q.name,
    status: q.status,
    joinUrl: queueJoinUrl(q.id),
    createdAt: toMs(q.createdAt),
    updatedAt: toMs(q.updatedAt),
  };
  if (live !== undefined) view.live = live;
  // PRI-07: "Priority lane on · 1 in N" is public.
  view.priority = priorityInfo(QueueSettings.parse(q.settingsJson));
  if (role) {
    view.settings = QueueSettings.parse(q.settingsJson);
    view.settingsVersion = q.settingsVersion;
  }
  return view;
}

/** D1 map snapshot → live summary (QUE-18). */
export function snapshotSummary(s: QueueSnapshot): QueueLiveSummary {
  return {
    status: !s.isOpen ? "closed" : s.isPaused ? "paused" : "open",
    nowServing: s.nowServing,
    waiting: s.waiting,
    waitLowMs: s.etaLowMs,
    waitHighMs: s.etaHighMs,
    updatedAt: toMs(s.updatedAt),
    inService: s.inService,
  };
}

async function loadSnapshots(
  db: Db,
  queueIds: string[],
): Promise<Map<string, QueueLiveSummary>> {
  if (queueIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(queueSnapshots)
    .where(inArray(queueSnapshots.queueId, queueIds))
    .all();
  return new Map(rows.map((r) => [r.queueId, snapshotSummary(r)]));
}

/** BIZ-07: what is still missing before the business can be listed on the map. */
function missingForListing(b: Business, qs: Queue[]): ListingRequirement[] {
  const missing: ListingRequirement[] = [];
  if (b.lat === null || b.lng === null) missing.push("pin");
  if (!qs.some((q) => q.status === "active")) missing.push("queue");
  return missing;
}

/** Listed = active AND has a pin AND at least one non-archived queue. */
export function isListed(b: Business, qs: Queue[]): boolean {
  return b.status === "active" && missingForListing(b, qs).length === 0;
}

function location(b: Business) {
  return b.lat !== null && b.lng !== null ? { lat: b.lat, lng: b.lng } : null;
}

function businessView(
  b: Business,
  qs: Queue[],
  role: BusinessRole | null,
  snapshots: Map<string, QueueLiveSummary>,
  now: number,
): BusinessView {
  const visibleQueues = role ? qs : qs.filter((q) => q.status === "active");
  const view: BusinessView = {
    id: b.id,
    name: b.name,
    category: b.category,
    address: b.address,
    phone: b.phone,
    location: location(b),
    hours: b.hoursJson,
    isOpenNow: isOpenAt(b.hoursJson, now),
    todayHours: todayHours(b.hoursJson, now),
    status: b.status,
    listed: isListed(b, qs),
    myRole: role,
    queues: visibleQueues.map((q) =>
      queueView(q, role, snapshots.get(q.id) ?? null),
    ),
    createdAt: toMs(b.createdAt),
    updatedAt: toMs(b.updatedAt),
  };
  if (role === "owner") view.missingForListing = missingForListing(b, qs);
  if (role) view.publicStats = b.publicStats;
  return view;
}

/**
 * Sets `first_listed_at` the first time the business is listed (BIZ-07 rule in
 * SQL). Call after anything that can make a business listed: pin set, queue
 * created, activation. Never cleared (MAP-06 clock).
 */
async function markFirstListed(
  db: Db,
  businessId: string,
  now: number,
): Promise<void> {
  await db.run(sql`
    UPDATE ${businesses} SET first_listed_at = ${now}
    WHERE id = ${businessId} AND first_listed_at IS NULL
      AND status = 'active' AND lat IS NOT NULL AND lng IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM ${queues} q
        WHERE q.business_id = ${businessId} AND q.status = 'active'
      )
  `);
}

/** MAP-06: non-members see stats after 14 days listed, or when the owner opted in. */
export function statsVisible(
  b: Business,
  role: BusinessRole | null,
  now: number,
): boolean {
  if (role) return true;
  if (b.publicStats) return true;
  return (
    b.firstListedAt !== null &&
    now - toMs(b.firstListedAt) >= STATS_PUBLIC_AFTER_DAYS * DAY_MS
  );
}

const avgOrNull = (sum: number, n: number) =>
  n >= STATS_MIN_SAMPLES ? Math.round(sum / n) : null;

/**
 * MAP-05: public stats from `analytics_hourly` over the last 28 days, one
 * aggregate query on idx(business_id, hour_start).
 */
export async function businessStats(
  db: Db,
  businessId: string,
  now: number,
): Promise<BusinessStats> {
  const since = now - STATS_WINDOW_DAYS * DAY_MS;
  const row = await db
    .select({
      served: sql<number>`COALESCE(SUM(${analyticsHourly.served}), 0)`,
      sumWaitMs: sql<number>`COALESCE(SUM(${analyticsHourly.sumWaitMs}), 0)`,
      waits: sql<number>`COALESCE(SUM(${analyticsHourly.waits}), 0)`,
      sumIntervalMs: sql<number>`COALESCE(SUM(${analyticsHourly.sumIntervalMs}), 0)`,
      intervals: sql<number>`COALESCE(SUM(${analyticsHourly.intervals}), 0)`,
      etaHits: sql<number>`COALESCE(SUM(${analyticsHourly.etaHits}), 0)`,
      etaTotal: sql<number>`COALESCE(SUM(${analyticsHourly.etaTotal}), 0)`,
    })
    .from(analyticsHourly)
    .where(
      and(
        eq(analyticsHourly.businessId, businessId),
        gte(analyticsHourly.hourStart, since),
      ),
    )
    .get();
  const r = row ?? {
    served: 0,
    sumWaitMs: 0,
    waits: 0,
    sumIntervalMs: 0,
    intervals: 0,
    etaHits: 0,
    etaTotal: 0,
  };
  const eta = avgOrNull(r.etaHits * 100, r.etaTotal);
  return {
    windowDays: STATS_WINDOW_DAYS,
    servedCount: r.served,
    avgWaitMs: avgOrNull(r.sumWaitMs, r.waits),
    avgServiceMs: avgOrNull(r.sumIntervalMs, r.intervals),
    etaAccuracyPct: eta,
  };
}

export async function loadQueues(
  db: Db,
  businessIds: string[],
): Promise<Queue[]> {
  if (businessIds.length === 0) return [];
  return db
    .select()
    .from(queues)
    .where(inArray(queues.businessId, businessIds))
    .orderBy(asc(queues.createdAt), asc(queues.id))
    .all();
}

export async function loadBusiness(
  db: Db,
  businessId: string,
): Promise<Business> {
  const b = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .get();
  if (!b) throw notFound();
  return b;
}

async function viewFor(
  db: Db,
  businessId: string,
  role: BusinessRole | null,
  now: number,
): Promise<BusinessView> {
  const b = await loadBusiness(db, businessId);
  const qs = await loadQueues(db, [b.id]);
  return businessView(
    b,
    qs,
    role,
    await loadSnapshots(
      db,
      qs.map((q) => q.id),
    ),
    now,
  );
}

// ---------- businesses ----------

/** BIZ-01: create a business; the creator becomes its owner. */
export async function createBusiness(
  { db, now }: ServiceCtx,
  ownerUserId: string,
  body: CreateBusinessBody,
): Promise<BusinessView> {
  const id = newId();
  const at = new Date(now);
  await db.batch([
    db.insert(businesses).values({
      id,
      ownerUserId,
      name: body.name,
      category: body.category,
      address: body.address,
      phone: body.phone ?? null,
      lat: body.location?.lat ?? null,
      lng: body.location?.lng ?? null,
      geohash: body.location ? geohash(body.location) : null,
      hoursJson: body.hours,
      status: "active",
      createdAt: at,
      updatedAt: at,
    }),
    db.insert(businessMembers).values({
      businessId: id,
      userId: ownerUserId,
      role: "owner",
      createdAt: at,
      updatedAt: at,
    }),
  ]);
  return viewFor(db, id, "owner", now);
}

/** BIZ-09/BIZ-15: businesses the user is a member of, with role and queues. */
export async function listMyBusinesses(
  db: Db,
  userId: string,
  now: number,
): Promise<BusinessView[]> {
  const rows = await db
    .select({ business: businesses, role: businessMembers.role })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .where(eq(businessMembers.userId, userId))
    .orderBy(asc(businesses.createdAt), asc(businesses.id))
    .all();
  const qs = await loadQueues(
    db,
    rows.map((r) => r.business.id),
  );
  const snaps = await loadSnapshots(
    db,
    qs.map((q) => q.id),
  );
  return rows.map((r) =>
    businessView(
      r.business,
      qs.filter((q) => q.businessId === r.business.id),
      r.role,
      snaps,
      now,
    ),
  );
}

/**
 * Members see the full view; others only a listed business (else 404). Adds
 * the MAP-05 stats, hidden from non-members by the MAP-06 rule.
 */
export async function getBusinessForViewer(
  db: Db,
  businessId: string,
  userId: string,
  now: number,
): Promise<BusinessView> {
  const b = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .get();
  if (!b) throw notFound();
  const role = await findRole(db, b.id, userId);
  const qs = await loadQueues(db, [b.id]);
  if (!role && !isListed(b, qs)) throw notFound();
  const view = businessView(
    b,
    qs,
    role,
    await loadSnapshots(
      db,
      qs.map((q) => q.id),
    ),
    now,
  );
  view.stats = statsVisible(b, role, now)
    ? await businessStats(db, b.id, now)
    : null;
  return view;
}

/** BIZ-02/04/05: partial update, including moving the pin. Caller is the owner. */
export async function updateBusiness(
  { db, now, env }: ServiceCtx,
  businessId: string,
  patch: UpdateBusinessBody,
): Promise<BusinessView> {
  const set: Partial<typeof businesses.$inferInsert> = {
    updatedAt: new Date(now),
  };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.address !== undefined) set.address = patch.address;
  if (patch.phone !== undefined) set.phone = patch.phone;
  if (patch.hours !== undefined) set.hoursJson = patch.hours;
  if (patch.publicStats !== undefined) set.publicStats = patch.publicStats;
  if (patch.location !== undefined) {
    set.lat = patch.location.lat;
    set.lng = patch.location.lng;
    set.geohash = geohash(patch.location);
  }
  const updated = await db
    .update(businesses)
    .set(set)
    .where(eq(businesses.id, businessId))
    .returning({ id: businesses.id });
  if (updated.length === 0) throw notFound();
  if (patch.location !== undefined) {
    // BIZ-04: the map snapshot follows the pin immediately.
    await db
      .update(queueSnapshots)
      .set({ lat: patch.location.lat, lng: patch.location.lng })
      .where(eq(queueSnapshots.businessId, businessId));
    await markFirstListed(db, businessId, now);
  }
  if (patch.name !== undefined || patch.hours !== undefined) {
    for (const q of await loadQueues(db, [businessId])) {
      const stub = queueStub(env, q.id);
      if (patch.name !== undefined) {
        await stub.setLabels({ businessName: patch.name });
      }
      // B20: the auto-close follows the new hours at once.
      if (patch.hours !== undefined && q.status === "active") {
        await stub.setHours(patch.hours);
      }
    }
  }
  return viewFor(db, businessId, "owner", now);
}

/**
 * BIZ-08: deactivate/activate. Idempotent; `updated_at` only moves on a real
 * change. Deactivating closes every queue's live session (tokens expire).
 */
export async function setBusinessStatus(
  { db, now, env }: ServiceCtx,
  businessId: string,
  status: Business["status"],
): Promise<BusinessView> {
  await db
    .update(businesses)
    .set({ status, updatedAt: new Date(now) })
    .where(
      and(
        eq(businesses.id, businessId),
        sql`${businesses.status} <> ${status}`,
      ),
    );
  if (status === "inactive") {
    for (const q of await loadQueues(db, [businessId])) {
      // The business cancels: every paid token (BOOKED passes too) is
      // refunded in full and nothing carries over (§10.5, PAY-15).
      const r = unwrap(await queueStub(env, q.id).close({ business: true }));
      await refundAfterClose({ db, now, env }, r.paidTokens);
    }
  } else {
    await markFirstListed(db, businessId, now);
  }
  return viewFor(db, businessId, "owner", now);
}

// ---------- queues ----------

/** BIZ-10/12: new queue with default settings merged with the patch. Max 10 active. */
export async function createQueue(
  { db, now, env }: ServiceCtx,
  businessId: string,
  body: CreateQueueBody,
): Promise<QueueView> {
  const id = newId();
  const settings = QueueSettings.parse(body.settings ?? {});
  // One statement: the limit check and the insert cannot race each other.
  const result = await db.run(sql`
    INSERT INTO ${queues}
      (id, business_id, name, status, settings_json, settings_version, created_at, updated_at)
    SELECT ${id}, ${businessId}, ${body.name}, 'active', ${JSON.stringify(settings)}, 1, ${now}, ${now}
    WHERE (
      SELECT COUNT(*) FROM ${queues}
      WHERE business_id = ${businessId} AND status = 'active'
    ) < ${MAX_ACTIVE_QUEUES}
  `);
  if (result.meta.changes !== 1) {
    throw new AppError(
      409,
      "conflict",
      `A business can have at most ${MAX_ACTIVE_QUEUES} active queues`,
    );
  }
  await markFirstListed(db, businessId, now);
  const q = await loadQueue(db, id);
  await initQueueDO(db, env, q);
  return queueView(q, "owner");
}

/** Gives the QueueDO its identity, names and settings. Idempotent. */
export async function initQueueDO(
  db: Db,
  env: Pick<Bindings, "QUEUE">,
  q: Queue,
): Promise<void> {
  const b = await loadBusiness(db, q.businessId);
  const stub = queueStub(env, q.id);
  await stub.init({
    queueId: q.id,
    businessId: q.businessId,
    settings: QueueSettings.parse(q.settingsJson),
    settingsVersion: q.settingsVersion,
    queueName: q.name,
    businessName: b.name,
  });
  // B20: the DO needs the hours for its auto-close.
  await stub.setHours(b.hoursJson);
}

export async function loadQueue(db: Db, queueId: string): Promise<Queue> {
  const q = await db.select().from(queues).where(eq(queues.id, queueId)).get();
  if (!q) throw notFound();
  return q;
}

/**
 * BIZ-11/12: rename and/or patch settings. `settings_version` goes up only when
 * the merged settings differ from the stored ones.
 */
export async function updateQueue(
  { db, now, env }: ServiceCtx,
  queueId: string,
  body: UpdateQueueBody,
): Promise<QueueView> {
  const q = await loadQueue(db, queueId);
  if (q.status === "archived") {
    throw new AppError(409, "invalid_state", "Archived queues can't be edited");
  }

  const set: Partial<typeof queues.$inferInsert> = {};
  if (body.name !== undefined && body.name !== q.name) set.name = body.name;
  if (body.settings !== undefined) {
    const current = QueueSettings.parse(q.settingsJson);
    const merged = QueueSettings.parse({ ...current, ...body.settings });
    if (JSON.stringify(merged) !== JSON.stringify(current)) {
      set.settingsJson = merged;
      set.settingsVersion = q.settingsVersion + 1;
    }
  }
  if (Object.keys(set).length === 0) return queueView(q, "owner");

  set.updatedAt = new Date(now);
  // Guard on the version we read so two concurrent patches can't both apply one bump.
  const updated = await db
    .update(queues)
    .set(set)
    .where(
      and(
        eq(queues.id, queueId),
        eq(queues.settingsVersion, q.settingsVersion),
      ),
    )
    .returning();
  if (updated.length === 0) {
    throw new AppError(
      409,
      "conflict",
      "The queue was changed at the same time; try again",
    );
  }
  const stub = queueStub(env, queueId);
  if (set.settingsJson && set.settingsVersion) {
    // Applies to new tokens only; the DO ignores versions it already has.
    await stub.updateSettings(set.settingsJson, set.settingsVersion);
  }
  if (set.name) await stub.setLabels({ queueName: set.name });
  return queueView(updated[0], "owner");
}

/** Active (WAITING/CALLED/GRACE) tokens in a queue, from its QueueDO. */
export async function countActiveTokens(
  env: Pick<Bindings, "QUEUE">,
  queueId: string,
): Promise<number> {
  return queueStub(env, queueId).countActiveTokens();
}

/** BIZ-11: archive a queue, only when nobody is waiting. Idempotent. Ends its session. */
export async function archiveQueue(
  { db, now, env }: ServiceCtx,
  queueId: string,
): Promise<QueueView> {
  const q = await loadQueue(db, queueId);
  if (q.status === "archived") return queueView(q, "owner");
  if ((await countActiveTokens(env, queueId)) > 0) {
    throw new AppError(
      409,
      "invalid_state",
      "The queue still has waiting tokens",
    );
  }
  // Archive = the business ends this queue: BOOKED passes are refunded (§10.5).
  const closed = unwrap(
    await queueStub(env, queueId).close({ business: true }),
  );
  await refundAfterClose({ db, now, env }, closed.paidTokens);
  const [updated] = await db
    .update(queues)
    .set({ status: "archived", updatedAt: new Date(now) })
    .where(eq(queues.id, queueId))
    .returning();
  return queueView(updated, "owner");
}

/**
 * JON-03: public queue info. Non-members get 404 unless the queue is active and
 * its business is listed.
 */
export async function getQueueInfo(
  { db, env, now }: ServiceCtx,
  queueId: string,
  userId: string,
): Promise<QueueInfoResponse> {
  const q = await db.select().from(queues).where(eq(queues.id, queueId)).get();
  if (!q) throw notFound();
  const b = await loadBusiness(db, q.businessId);
  const role = await findRole(db, b.id, userId);
  const listed = isListed(b, await loadQueues(db, [b.id]));
  if (!role && (!listed || q.status !== "active")) throw notFound();
  const settings = QueueSettings.parse(q.settingsJson);
  const live = await queueStub(env, q.id).getSummary();
  return {
    queue: queueView(q, role),
    business: {
      id: b.id,
      name: b.name,
      category: b.category,
      address: b.address,
      location: location(b),
      status: b.status,
      listed,
      isOpenNow: isOpenAt(b.hoursJson, now),
      todayHours: todayHours(b.hoursJson, now),
    },
    myRole: role,
    live,
    // The join screen shows the walk-in radius to everyone.
    joinRadiusM: settings.joinRadiusM,
    // Step 4 (§12): the public Priority Pass fields for "Priority lane on ·
    // 1 in N", the price and "Sold out". Other settings stay members-only.
    priority: {
      ...priorityInfo(settings),
      soldOut: live.priority?.soldOut ?? false,
    },
  };
}
