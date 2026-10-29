import {
  ACTIVE_TOKEN_STATES,
  type CancelResponse,
  type ConsoleState,
  type ConsoleToken,
  distanceMeters,
  type JoinBody,
  type LocationCheckBody,
  type MyTokensQuery,
  normalizeCheckCode,
  type PriorityPreview,
  parseTokenLabel,
  QueueSettings,
  type StaffRejoinBody,
  type TokenSummary,
  type TokenView,
  type TriageResponse,
  tokenLabel,
  verifyTicket,
} from "@qpeer/shared";
import { and, desc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  businesses,
  freeLaneStrikes,
  type Queue,
  queues,
  type TokenRow,
  tokens,
  type User,
  users,
} from "../../db/schema";
import { AppError, notFound } from "../../lib/errors";
import { ticketPublicKeys, withTicket } from "../../lib/ticket-sign";
import { toMs } from "../../lib/time";
import { findRole } from "../../middleware/guards";
import {
  STRIKE_BLOCK_MS,
  STRIKE_LIMIT,
  STRIKE_WINDOW_MS,
} from "../../queue/outbox";
import type { DoResult, StaffRejoinRef } from "../../queue/queue-do";
import {
  initQueueDO,
  isListed,
  loadBusiness,
  loadQueue,
  loadQueues,
} from "../business/service";
import {
  type PayEnv,
  refundDueForToken,
  refundOutcomes,
} from "../payments/service";
import { queueStub, unwrap } from "./do-client";

/**
 * Worker side of the live queue (M3/M4/M5): authorises, then calls the QueueDO.
 * The DO never checks permissions itself (§6).
 */
export interface QueueCtx {
  db: Db;
  env: PayEnv;
  now: number;
}

/** Reported accuracy worse than this = no usable fix (JON-05). */
export const MAX_ACCURACY_M = 1000;

const ACTIVE = ACTIVE_TOKEN_STATES;
const RECENT_LIMIT = 20;

// ---------- console (staff; the route guard resolved queue → business) ----------

type ConsoleAction =
  | "pause"
  | "resume"
  | "undo-next"
  | "keep-open"
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

/**
 * QUE-09: close for the day; remaining tokens expire. Paid tokens that end
 * are refunded (PAY-09, C6) right away; MISSED ones are forfeited unless the
 * close is early (PAY-14/15). A failed refund is retried by the cron.
 */
export async function closeQueue(
  ctx: QueueCtx,
  queueId: string,
): Promise<ConsoleState> {
  const r = unwrap(await queueStub(ctx.env, queueId).close());
  await refundOutcomes(ctx, r.paidTokens);
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
    case "keep-open":
      r = await stub.keepOpen();
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

/**
 * Console state; C4 (2026-10-18): staff see each holder's full name when
 * online (added here from D1; socket messages never carry names).
 */
export async function getConsole(
  { db, env }: QueueCtx,
  queueId: string,
): Promise<ConsoleState> {
  const stub = queueStub(env, queueId);
  const [state, owners] = await Promise.all([
    stub.getState(),
    stub.consoleOwners(),
  ]);
  const userIds = [...new Set(Object.values(owners))];
  if (userIds.length === 0) return state;
  const names = new Map<string, string | null>();
  for (let i = 0; i < userIds.length; i += 90) {
    const rows = await db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, userIds.slice(i, i + 90)))
      .all();
    for (const r of rows) names.set(r.id, r.name);
  }
  const named = (t: ConsoleToken): ConsoleToken => {
    const uid = owners[t.id];
    return uid ? { ...t, holderName: names.get(uid) ?? null } : t;
  };
  return {
    ...state,
    serving: state.serving.map(named),
    waiting: state.waiting.map(named),
    grace: state.grace.map(named),
    missed: state.missed?.map(named),
  };
}

/**
 * R2 / QUE-29 staff "Rejoin for customer" after MISSED: ticket label +
 * check code, or a scanned signed ticket QR (verified with the server's own
 * keys, for this queue). Same once-only and position rule as "I'm here".
 */
export async function staffRejoin(
  { env, now }: QueueCtx,
  queueId: string,
  body: StaffRejoinBody,
): Promise<{ token: TokenView; console: ConsoleState }> {
  let ref: StaffRejoinRef;
  if ("signedTicket" in body) {
    const check = verifyTicket(body.signedTicket, await ticketPublicKeys(env), {
      now,
      queueId,
    });
    if (check.status !== "valid") {
      throw new AppError(404, "not_found", "This ticket can't be used here", {
        ticket: check.status,
      });
    }
    ref = { tokenId: check.payload.t };
  } else {
    const label = parseTokenLabel(body.label);
    const code = normalizeCheckCode(body.checkCode);
    if (!label || !code)
      throw new AppError(404, "not_found", "No ticket matches");
    ref = { ...label, checkCode: code };
  }
  return unwrap(await queueStub(env, queueId).staffRejoin(ref));
}

/** PRI-02: the honest preview before buying a pass (any signed-in user). */
export async function priorityPreview(
  { db, env }: QueueCtx,
  queueId: string,
): Promise<PriorityPreview> {
  await loadJoinable(db, queueId);
  return queueStub(env, queueId).priorityPreview();
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
  // Read in parallel with the DO pre-check (no extra round trip on the path).
  const deviceUntilP = body.deviceHash
    ? deviceBlockedUntil(db, body.deviceHash, now)
    : Promise.resolve(null);
  deviceUntilP.catch(() => undefined);
  unwrap(await stub.checkJoin());
  const t2 = Date.now();

  checkLocation(body, business, QueueSettings.parse(queue.settingsJson));
  const blockedUntil = user.freeLaneBlockedUntil
    ? toMs(user.freeLaneBlockedUntil)
    : null;
  const deviceUntil = await deviceUntilP;
  const until = Math.max(blockedUntil ?? 0, deviceUntil ?? 0);
  if (until > now) {
    throw new AppError(
      423,
      "free_lane_blocked",
      "Free joins are paused after repeated no-shows",
      { until },
    );
  }
  // TODO(NFR-11): endpoint rate limit for joins (only queue-level caps for now).
  const result = await stub.allocate({
    method: "walkin",
    userId: user.id,
    cls: "regular",
    deviceHash: body.deviceHash ?? null,
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
  return withTicket(env, unwrap(result).token, user);
}

/** Joins slower than this log their phase timings. */
const SLOW_JOIN_MS = 1_000;

/**
 * The walk-in GPS check (JON-05), shared by join, "I'm here" rejoin (QUE-23)
 * and Priority Pass check-in (PRI-03): mocked → 422 `mock_location`,
 * accuracy > 1000 m → 422 `no_location_fix`, distance − accuracy > radius
 * → 422 `too_far`. The location is used for this check only: never stored,
 * sent to the DO or logged.
 */
export function checkLocation(
  body: { lat: number; lng: number; accuracyM: number; mocked: boolean },
  business: { lat: number; lng: number },
  settings: QueueSettings,
): void {
  if (body.mocked) {
    throw new AppError(422, "mock_location", "Fake location detected");
  }
  if (body.accuracyM > MAX_ACCURACY_M) {
    throw new AppError(
      422,
      "no_location_fix",
      "Location is not accurate enough",
      { maxAccuracyM: MAX_ACCURACY_M },
    );
  }
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
}

/** The owner's token row plus its queue's pin and settings, for a GPS check. */
async function ownTokenWithPlace(db: Db, tokenId: string, userId: string) {
  const row = await db
    .select()
    .from(tokens)
    .where(eq(tokens.id, tokenId))
    .get();
  if (!row || row.userId !== userId) throw notFound();
  const q = await loadQueue(db, row.queueId);
  const b = await loadBusiness(db, q.businessId);
  if (b.lat === null || b.lng === null) throw notFound();
  return {
    row,
    business: { lat: b.lat, lng: b.lng },
    settings: QueueSettings.parse(q.settingsJson),
  };
}

/**
 * QUE-23 "I'm here" after MISSED: the walk-in GPS check, then the DO places
 * the ticket (R1). Once per ticket. Owner only.
 */
export async function rejoinToken(
  { db, env }: QueueCtx,
  user: User,
  tokenId: string,
  body: LocationCheckBody,
): Promise<TokenView> {
  const { row, business, settings } = await ownTokenWithPlace(
    db,
    tokenId,
    user.id,
  );
  checkLocation(body, business, settings);
  const view = unwrap(
    await queueStub(env, row.queueId).rejoin(tokenId, user.id),
  );
  return withTicket(env, view, user);
}

/**
 * PRI-03 Priority Pass check-in on arrival: the walk-in GPS check (a photo
 * of the counter QR alone is not enough), then BOOKED → the priority lane.
 */
export async function checkInToken(
  { db, env }: QueueCtx,
  user: User,
  tokenId: string,
  body: LocationCheckBody,
): Promise<TokenView> {
  const { row, business, settings } = await ownTokenWithPlace(
    db,
    tokenId,
    user.id,
  );
  checkLocation(body, business, settings);
  const view = unwrap(
    await queueStub(env, row.queueId).checkIn(tokenId, user.id),
  );
  return withTicket(env, view, user);
}

/**
 * C2: the JON-07 rule per device hash: 3 no-shows on this phone within 30
 * days pause free joins until 7 days after the last one, whichever account
 * the phone uses now. Null when not blocked.
 */
export async function deviceBlockedUntil(
  db: Db,
  deviceHash: string,
  now: number,
): Promise<number | null> {
  const row = await db
    .select({
      n: sql<number>`COUNT(*)`,
      last: sql<number | null>`MAX(${freeLaneStrikes.at})`,
    })
    .from(freeLaneStrikes)
    .where(
      and(
        eq(freeLaneStrikes.deviceHash, deviceHash),
        gt(freeLaneStrikes.at, new Date(now - STRIKE_WINDOW_MS)),
      ),
    )
    .get();
  if (!row || row.n < STRIKE_LIMIT || row.last === null) return null;
  return Number(row.last) + STRIKE_BLOCK_MS;
}

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
    sessionId: row.sessionId,
    cls: row.class,
    expiresAt: row.expiresAt ? toMs(row.expiresAt) : null,
    checkCode: row.checkCode,
    missedAt: row.missedAt ? toMs(row.missedAt) : null,
    checkedInAt: row.checkedInAt ? toMs(row.checkedInAt) : null,
  };
}

/** C4: the holder whose first name / last 4 phone digits go in the signed ticket. */
async function holderOf(
  db: Db,
  userId: string | null,
  caller: User,
): Promise<User | null> {
  if (!userId) return null;
  if (userId === caller.id) return caller;
  return (
    (await db.select().from(users).where(eq(users.id, userId)).get()) ?? null
  );
}

/** TOK-01/TOK-03: live token view (owner or staff of its business). */
export async function getToken(
  { db, env }: QueueCtx,
  tokenId: string,
  user: User,
): Promise<TokenView> {
  const { row } = await loadTokenFor(db, tokenId, user.id);
  const r = await queueStub(env, row.queueId).getToken(tokenId);
  if (r.ok) {
    const holder = await holderOf(db, r.value.userId, user);
    return withTicket(env, r.value.token, holder);
  }
  return viewFromRow(row, await namesFor(db, row.queueId));
}

/**
 * QUE-10/TOK-05: leave (no refund). Owner, or staff of the business acting
 * for them. A BOOKED pass is cancelled instead (refund at the business's %).
 */
export async function leaveToken(
  ctx: QueueCtx,
  tokenId: string,
  userId: string,
): Promise<TokenView> {
  const { db, env } = ctx;
  const { row, isOwner } = await loadTokenFor(db, tokenId, userId);
  const view = unwrap(
    await queueStub(env, row.queueId).leave(tokenId, isOwner ? userId : null),
  );
  if (view.paid) await refundDueForToken(ctx, tokenId);
  return view;
}

/**
 * TOK-05 / PAY-07: cancel. Free tokens = leave. Paid: the DO decides the
 * refund (reservation inside the cancel window; BOOKED pass at the
 * business's %); the Refunds API is called right away (cron retries).
 */
export async function cancelToken(
  ctx: QueueCtx,
  tokenId: string,
  userId: string,
): Promise<CancelResponse> {
  const { db, env } = ctx;
  const { row, isOwner } = await loadTokenFor(db, tokenId, userId);
  const r = unwrap(
    await queueStub(env, row.queueId).cancel(tokenId, isOwner ? userId : null),
  );
  if (r.refund) await refundDueForToken(ctx, tokenId);
  return { token: r.token, refund: r.refund, refundPct: r.refundPct };
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
    expiresAt: t.expiresAt ? toMs(t.expiresAt) : null,
    checkCode: t.checkCode,
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
