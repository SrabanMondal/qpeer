import {
  type BusinessRole,
  type BusinessView,
  type CreateBusinessBody,
  type CreateQueueBody,
  type ListingRequirement,
  type QueueInfoResponse,
  QueueSettings,
  type QueueView,
  queueJoinUrl,
  type UpdateBusinessBody,
  type UpdateQueueBody,
} from "@qpeer/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  type Business,
  businesses,
  businessMembers,
  type Queue,
  queues,
} from "../../db/schema";
import { AppError, notFound } from "../../lib/errors";
import { geohash } from "../../lib/geo";
import { newId } from "../../lib/ids";
import { toMs } from "../../lib/time";
import { findRole } from "../../middleware/guards";

export const MAX_ACTIVE_QUEUES = 10;

export interface ServiceCtx {
  db: Db;
  now: number;
}

// ---------- views ----------

function queueView(q: Queue, role: BusinessRole | null): QueueView {
  const view: QueueView = {
    id: q.id,
    businessId: q.businessId,
    name: q.name,
    status: q.status,
    joinUrl: queueJoinUrl(q.id),
    createdAt: toMs(q.createdAt),
    updatedAt: toMs(q.updatedAt),
  };
  if (role) {
    view.settings = QueueSettings.parse(q.settingsJson);
    view.settingsVersion = q.settingsVersion;
  }
  return view;
}

/** BIZ-07: what is still missing before the business can be listed on the map. */
function missingForListing(b: Business, qs: Queue[]): ListingRequirement[] {
  const missing: ListingRequirement[] = [];
  if (b.lat === null || b.lng === null) missing.push("pin");
  if (!qs.some((q) => q.status === "active")) missing.push("queue");
  return missing;
}

/** Listed = active AND has a pin AND at least one non-archived queue. */
function isListed(b: Business, qs: Queue[]): boolean {
  return b.status === "active" && missingForListing(b, qs).length === 0;
}

function location(b: Business) {
  return b.lat !== null && b.lng !== null ? { lat: b.lat, lng: b.lng } : null;
}

function businessView(
  b: Business,
  qs: Queue[],
  role: BusinessRole | null,
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
    status: b.status,
    listed: isListed(b, qs),
    myRole: role,
    queues: visibleQueues.map((q) => queueView(q, role)),
    createdAt: toMs(b.createdAt),
    updatedAt: toMs(b.updatedAt),
  };
  if (role === "owner") view.missingForListing = missingForListing(b, qs);
  return view;
}

async function loadQueues(db: Db, businessIds: string[]): Promise<Queue[]> {
  if (businessIds.length === 0) return [];
  return db
    .select()
    .from(queues)
    .where(inArray(queues.businessId, businessIds))
    .orderBy(asc(queues.createdAt), asc(queues.id))
    .all();
}

async function loadBusiness(db: Db, businessId: string): Promise<Business> {
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
): Promise<BusinessView> {
  const b = await loadBusiness(db, businessId);
  return businessView(b, await loadQueues(db, [b.id]), role);
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
  return viewFor(db, id, "owner");
}

/** BIZ-09/BIZ-15: businesses the user is a member of, with role and queues. */
export async function listMyBusinesses(
  db: Db,
  userId: string,
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
  return rows.map((r) =>
    businessView(
      r.business,
      qs.filter((q) => q.businessId === r.business.id),
      r.role,
    ),
  );
}

/** Members see the full view; others only a listed business (else 404). */
export async function getBusinessForViewer(
  db: Db,
  businessId: string,
  userId: string,
): Promise<BusinessView> {
  const b = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .get();
  if (!b) throw notFound();
  const role = await findRole(db, b.id, userId);
  const view = businessView(b, await loadQueues(db, [b.id]), role);
  if (!role && !view.listed) throw notFound();
  return view;
}

/** BIZ-02/04/05: partial update, including moving the pin. Caller is the owner. */
export async function updateBusiness(
  { db, now }: ServiceCtx,
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
  return viewFor(db, businessId, "owner");
}

/** BIZ-08: deactivate/activate. Idempotent; `updated_at` only moves on a real change. */
export async function setBusinessStatus(
  { db, now }: ServiceCtx,
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
  // Step 2: deactivation also closes the business's open queues in their QueueDOs.
  return viewFor(db, businessId, "owner");
}

// ---------- queues ----------

/** BIZ-10/12: new queue with default settings merged with the patch. Max 10 active. */
export async function createQueue(
  { db, now }: ServiceCtx,
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
  return queueView(await loadQueue(db, id), "owner");
}

async function loadQueue(db: Db, queueId: string): Promise<Queue> {
  const q = await db.select().from(queues).where(eq(queues.id, queueId)).get();
  if (!q) throw notFound();
  return q;
}

/**
 * BIZ-11/12: rename and/or patch settings. `settings_version` goes up only when
 * the merged settings differ from the stored ones.
 */
export async function updateQueue(
  { db, now }: ServiceCtx,
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
      // Step 2: push { settings, version } to the QueueDO (applies to new tokens only).
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
  return queueView(updated[0], "owner");
}

/** Active (WAITING/CALLED/GRACE) tokens in a queue. */
export async function countActiveTokens(_queueId: string): Promise<number> {
  // Step 2: ask QueueDO
  return 0;
}

/** BIZ-11: archive a queue, only when nobody is waiting. Idempotent. */
export async function archiveQueue(
  { db, now }: ServiceCtx,
  queueId: string,
): Promise<QueueView> {
  const q = await loadQueue(db, queueId);
  if (q.status === "archived") return queueView(q, "owner");
  if ((await countActiveTokens(queueId)) > 0) {
    throw new AppError(
      409,
      "invalid_state",
      "The queue still has waiting tokens",
    );
  }
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
  db: Db,
  queueId: string,
  userId: string,
): Promise<QueueInfoResponse> {
  const q = await db.select().from(queues).where(eq(queues.id, queueId)).get();
  if (!q) throw notFound();
  const b = await loadBusiness(db, q.businessId);
  const role = await findRole(db, b.id, userId);
  const listed = isListed(b, await loadQueues(db, [b.id]));
  if (!role && (!listed || q.status !== "active")) throw notFound();
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
    },
    myRole: role,
  };
}
