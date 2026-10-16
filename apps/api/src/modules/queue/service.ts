import {
  type CancelResponse,
  type ConsoleState,
  distanceMeters,
  type JoinBody,
  type MyTokensQuery,
  QueueSettings,
  type TokenSummary,
  type TokenView,
  type TriageResponse,
  tokenLabel,
} from "@qpeer/shared";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  businesses,
  type Queue,
  queues,
  type TokenRow,
  tokens,
  type User,
} from "../../db/schema";
import type { Bindings } from "../../env";
import { AppError, notFound } from "../../lib/errors";
import { toMs } from "../../lib/time";
import { findRole } from "../../middleware/guards";
import type { DoResult } from "../../queue/queue-do";
import {
  initQueueDO,
  isListed,
  loadBusiness,
  loadQueue,
  loadQueues,
} from "../business/service";
import { queueStub, unwrap } from "./do-client";

/**
 * Worker side of the live queue (M3/M4/M5): authorises, then calls the QueueDO.
 * The DO never checks permissions itself (§6).
 */
export interface QueueCtx {
  db: Db;
  env: Pick<Bindings, "QUEUE">;
  now: number;
}

/** Reported accuracy worse than this = no usable fix (JON-05). */
export const MAX_ACCURACY_M = 1000;

const ACTIVE = ["WAITING", "CALLED", "GRACE"] as const;
const RECENT_LIMIT = 20;

// ---------- console (staff; the route guard resolved queue → business) ----------

type ConsoleAction =
  | "pause"
  | "resume"
  | "undo-next"
  | "skip"
  | "no-show"
  | "admit"
  | "served";

/** BIZ-13: open a session. Sends identity/names/settings first (idempotent). */
export async function openQueue(
  { db, env }: QueueCtx,
  queueId: string,
): Promise<ConsoleState> {
  const q = await loadQueue(db, queueId);
  const b = await loadBusiness(db, q.businessId);
  if (q.status === "archived") {
    throw new AppError(409, "invalid_state", "Archived queues can't be opened");
  }
  if (b.status !== "active") {
    throw new AppError(409, "invalid_state", "Activate the business first");
  }
  await initQueueDO(db, env, q);
  return unwrap(await queueStub(env, queueId).open());
}

/** QUE-09: close for the day; remaining tokens expire. */
export async function closeQueue(
  { env }: QueueCtx,
  queueId: string,
): Promise<ConsoleState> {
  const r = unwrap(await queueStub(env, queueId).close());
  // TODO(Step 4): refund r.paidTokens via the payments service.
  return r.console;
}

export async function nextToken(
  { env }: QueueCtx,
  queueId: string,
  counter: number | undefined,
): Promise<ConsoleState> {
  return unwrap(await queueStub(env, queueId).next(counter ?? 1));
}

export async function consoleAction(
  { env }: QueueCtx,
  queueId: string,
  action: ConsoleAction,
  tokenId?: string,
): Promise<ConsoleState> {
  const stub = queueStub(env, queueId);
  let r: DoResult<ConsoleState>;
  const tid = tokenId ?? "";
  switch (action) {
    case "pause":
      r = await stub.pause();
      break;
    case "resume":
      r = await stub.resume();
      break;
    case "undo-next":
      r = await stub.undoNext();
      break;
    case "skip":
      r = await stub.skip(tid);
      break;
    case "no-show":
      r = await stub.noShow(tid);
      break;
    case "admit":
      r = await stub.admit(tid);
      break;
    case "served":
      r = await stub.served(tid);
      break;
  }
  return unwrap(r);
}

export async function insertTriage(
  { env }: QueueCtx,
  queueId: string,
): Promise<TriageResponse> {
  return unwrap(await queueStub(env, queueId).insertTriage());
}

export async function getConsole(
  { env }: QueueCtx,
  queueId: string,
): Promise<ConsoleState> {
  return queueStub(env, queueId).getState();
}

// ---------- walk-in join (JON-04…07) ----------

/** Queue + business when the queue is active and its business is listed; else 404. */
async function loadJoinable(db: Db, queueId: string) {
  const q = await db.select().from(queues).where(eq(queues.id, queueId)).get();
  if (q?.status !== "active") throw notFound();
  // Independent reads: one D1 round trip instead of two (F2).
  const [b, qs] = await Promise.all([
    loadBusiness(db, q.businessId),
    loadQueues(db, [q.businessId]),
  ]);
  if (!isListed(b, qs) || b.lat === null || b.lng === null) {
    throw notFound();
  }
  return { queue: q, business: { ...b, lat: b.lat, lng: b.lng } };
}

/**
 * Walk-in join. Checks, in order: queue exists and business listed (404), queue
 * open (409), mocked (422), accuracy (422), distance (422), free-lane block (423),
 * already in queue (409). The location is used for the distance only: it is not
 * stored, not sent to the DO and not logged.
 *
 * Staff/owners may join their own queues as customers (one phone plays both
 * roles in device tests; small businesses' staff queue too).
 */
export async function joinQueue(
  { db, env, now }: QueueCtx,
  user: User,
  queueId: string,
  body: JoinBody,
): Promise<TokenView> {
  const t0 = Date.now();
  const { queue, business } = await loadJoinable(db, queueId);
  const t1 = Date.now();
  const stub = queueStub(env, queueId);
  unwrap(await stub.checkJoin());
  const t2 = Date.now();

  if (body.mocked) {
    throw new AppError(422, "mock_location", "Fake location detected");
  }
  if (body.accuracyM > MAX_ACCURACY_M) {
    throw new AppError(
      422,
      "no_location_fix",
      "Location is not accurate enough",
      {
        maxAccuracyM: MAX_ACCURACY_M,
      },
    );
  }
  const settings = QueueSettings.parse(queue.settingsJson);
  const distance = distanceMeters(
    { lat: body.lat, lng: body.lng },
    { lat: business.lat, lng: business.lng },
  );
  if (distance - body.accuracyM > settings.joinRadiusM) {
    throw new AppError(422, "too_far", "You are too far from this queue", {
      distanceM: Math.round(distance),
      joinRadiusM: settings.joinRadiusM,
    });
  }
  const blockedUntil = user.freeLaneBlockedUntil
    ? toMs(user.freeLaneBlockedUntil)
    : null;
  if (blockedUntil !== null && blockedUntil > now) {
    throw new AppError(
      423,
      "free_lane_blocked",
      "Free joins are paused after repeated no-shows",
      { until: blockedUntil },
    );
  }
  // TODO(NFR-11): endpoint rate limit for joins (only queue-level caps for now).
  const result = await stub.allocate({
    method: "walkin",
    userId: user.id,
    cls: "regular",
  });
  const t3 = Date.now();
  if (t3 - t0 >= SLOW_JOIN_MS) {
    // Phase timings only (G2): no user id, token or location.
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        where: "queue.join.slow",
        queueId,
        d1Ms: t1 - t0,
        checkJoinMs: t2 - t1,
        allocateMs: t3 - t2,
        totalMs: t3 - t0,
        ok: result.ok,
      }),
    );
  }
  return unwrap(result).token;
}

/** Joins slower than this log their phase timings. */
const SLOW_JOIN_MS = 1_000;

// ---------- tokens (TOK-01, TOK-05, TOK-06) ----------

/**
 * The durable token row if the caller owns it or is staff of its business;
 * otherwise 404 (no existence leak).
 */
async function loadTokenFor(
  db: Db,
  tokenId: string,
  userId: string,
): Promise<{ row: TokenRow; isOwner: boolean }> {
  const row = await db
    .select()
    .from(tokens)
    .where(eq(tokens.id, tokenId))
    .get();
  if (!row) throw notFound();
  const isOwner = row.userId === userId;
  if (!isOwner && !(await findRole(db, row.businessId, userId))) {
    throw notFound();
  }
  return { row, isOwner };
}

async function namesFor(db: Db, queueId: string) {
  const r = await db
    .select({ queueName: queues.name, businessName: businesses.name })
    .from(queues)
    .innerJoin(businesses, eq(businesses.id, queues.businessId))
    .where(eq(queues.id, queueId))
    .get();
  return r ?? { queueName: "", businessName: "" };
}

/** Fallback view from D1 when the DO no longer holds the token (older session). */
function viewFromRow(
  row: TokenRow,
  names: { queueName: string; businessName: string },
): TokenView {
  return {
    id: row.id,
    queueId: row.queueId,
    businessId: row.businessId,
    businessName: names.businessName,
    queueName: names.queueName,
    number: row.number,
    series: row.series,
    label: tokenLabel(row.series, row.number),
    method: row.method,
    state: row.state,
    queueStatus: "closed",
    peopleAhead: 0,
    nowServing: null,
    etaLowMs: null,
    etaHighMs: null,
    beBackByMs: null,
    leaveHomeByMs: null,
    counter: null,
    joinedAt: toMs(row.joinedAt),
    calledAt: row.calledAt ? toMs(row.calledAt) : null,
    graceUntil: null,
    endedAt: row.endedAt ? toMs(row.endedAt) : null,
    endReason: row.endReason,
    paid: row.paymentId !== null,
    rev: row.rev,
  };
}

/** TOK-01/TOK-03: live token view (owner or staff of its business). */
export async function getToken(
  { db, env }: QueueCtx,
  tokenId: string,
  userId: string,
): Promise<TokenView> {
  const { row } = await loadTokenFor(db, tokenId, userId);
  const r = await queueStub(env, row.queueId).getToken(tokenId);
  if (r.ok) return r.value.token;
  return viewFromRow(row, await namesFor(db, row.queueId));
}

/** QUE-10/TOK-05: leave. Owner, or staff of the business acting for them. */
export async function leaveToken(
  { db, env }: QueueCtx,
  tokenId: string,
  userId: string,
): Promise<TokenView> {
  const { row, isOwner } = await loadTokenFor(db, tokenId, userId);
  return unwrap(
    await queueStub(env, row.queueId).leave(tokenId, isOwner ? userId : null),
  );
}

/** TOK-05: cancel. Free tokens = leave; paid refunds come in Step 4. */
export async function cancelToken(
  { db, env }: QueueCtx,
  tokenId: string,
  userId: string,
): Promise<CancelResponse> {
  const { row, isOwner } = await loadTokenFor(db, tokenId, userId);
  const r = unwrap(
    await queueStub(env, row.queueId).cancel(tokenId, isOwner ? userId : null),
  );
  // TODO(Step 4): when r.token.paid && r.refund → Razorpay refund.
  return r;
}

/** TOK-06: my tokens from D1 — active (newest first) or recent history (last 20). */
export async function myTokens(
  db: Db,
  userId: string,
  status: MyTokensQuery["status"],
): Promise<TokenSummary[]> {
  const where =
    status === "active"
      ? and(eq(tokens.userId, userId), inArray(tokens.state, [...ACTIVE]))
      : and(eq(tokens.userId, userId), notInArray(tokens.state, [...ACTIVE]));
  const rows = await db
    .select({
      token: tokens,
      queueName: queues.name,
      businessName: businesses.name,
    })
    .from(tokens)
    .innerJoin(queues, eq(queues.id, tokens.queueId))
    .innerJoin(businesses, eq(businesses.id, tokens.businessId))
    .where(where)
    .orderBy(
      status === "active"
        ? desc(tokens.joinedAt)
        : desc(sql`coalesce(${tokens.endedAt}, ${tokens.joinedAt})`),
    )
    .limit(status === "active" ? 100 : RECENT_LIMIT)
    .all();
  return rows.map(({ token: t, queueName, businessName }) => ({
    id: t.id,
    queueId: t.queueId,
    businessId: t.businessId,
    businessName,
    queueName,
    number: t.number,
    series: t.series,
    label: tokenLabel(t.series, t.number),
    method: t.method,
    state: t.state,
    joinedAt: toMs(t.joinedAt),
    calledAt: t.calledAt ? toMs(t.calledAt) : null,
    endedAt: t.endedAt ? toMs(t.endedAt) : null,
    endReason: t.endReason,
  }));
}

// ---------- live (TOK-02, §9.9) ----------

/**
 * Authorises a live socket and returns the DO URL to forward the upgrade to.
 * Customer: must own the token, which must be in this queue. Console: staff of
 * the queue's business. Everything else is 404.
 */
export async function authorizeLive(
  { db, env }: QueueCtx,
  queueId: string,
  userId: string,
  query: { tokenId?: string; console?: string },
): Promise<string> {
  const q: Queue | undefined = await db
    .select()
    .from(queues)
    .where(eq(queues.id, queueId))
    .get();
  if (!q) throw notFound();
  if (query.console === "1") {
    if (!(await findRole(db, q.businessId, userId))) throw notFound();
    return "https://queue-do/live?console=1";
  }
  const tokenId = query.tokenId;
  if (!tokenId) {
    throw new AppError(
      400,
      "invalid_input",
      "tokenId or console=1 is required",
    );
  }
  const r = await queueStub(env, queueId).getToken(tokenId);
  if (!r.ok || r.value.userId !== userId) throw notFound();
  return `https://queue-do/live?tokenId=${encodeURIComponent(tokenId)}`;
}
