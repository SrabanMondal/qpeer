import type { Bindings } from "../../env";
import { notFound } from "../../lib/errors";
import type { AuditDump } from "../../queue/queue-do";
import { LOADTEST_TICKET_PREFIX } from "../notifications/expo-push";
import { queueStub } from "../queue/do-client";

/**
 * Load-test helpers (Step 3.5). Only reachable through `loadtest/routes.ts`,
 * which is 404 outside `ENVIRONMENT=loadtest`. Nothing here reads or returns
 * coordinates.
 */

/** Keeps every helper inside the free plan's subrequest limit per request. */
export const MAX_LOADTEST_QUEUES = 40;

type Env = Pick<Bindings, "DB" | "QUEUE">;

async function queueIds(d1: D1Database): Promise<string[]> {
  const { results } = await d1
    .prepare("SELECT id FROM queues ORDER BY created_at, id LIMIT ?")
    .bind(MAX_LOADTEST_QUEUES + 1)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

export interface LoadtestStats {
  /** Recorded (fake) push sends per (token, kind). */
  pushes: { tokenId: string; kind: string; count: number }[];
  analytics: {
    queueId: string;
    hourStart: number;
    joins: number;
    leaves: number;
    served: number;
    noShows: number;
    cancels: number;
  }[];
  snapshots: {
    queueId: string;
    businessId: string;
    isOpen: boolean;
    isPaused: boolean;
    waiting: number;
    updatedAt: number;
  }[];
  queues: {
    queueId: string;
    status: string;
    waiting: number;
    pendingOutbox: number;
  }[];
  truncated: boolean;
}

export async function loadtestStats(env: Env): Promise<LoadtestStats> {
  const d1 = env.DB;
  const [pushes, analytics, snapshots, ids] = await Promise.all([
    d1
      .prepare(
        `SELECT token_id AS tokenId, kind, COUNT(*) AS count FROM push_tickets
         WHERE id LIKE ? GROUP BY token_id, kind`,
      )
      .bind(`${LOADTEST_TICKET_PREFIX}%`)
      .all<{ tokenId: string; kind: string; count: number }>(),
    d1
      .prepare(
        `SELECT queue_id AS queueId, hour_start AS hourStart, joins, leaves, served,
           no_shows AS noShows, cancels FROM analytics_hourly ORDER BY queue_id, hour_start`,
      )
      .all<LoadtestStats["analytics"][number]>(),
    d1
      .prepare(
        `SELECT queue_id AS queueId, business_id AS businessId, is_open AS isOpen,
           is_paused AS isPaused, waiting, updated_at AS updatedAt FROM queue_snapshots`,
      )
      .all<{
        queueId: string;
        businessId: string;
        isOpen: number;
        isPaused: number;
        waiting: number;
        updatedAt: number;
      }>(),
    queueIds(d1),
  ]);
  const truncated = ids.length > MAX_LOADTEST_QUEUES;
  const queues = await Promise.all(
    ids.slice(0, MAX_LOADTEST_QUEUES).map(async (queueId) => {
      const stub = queueStub(env, queueId);
      const [summary, pendingOutbox] = await Promise.all([
        stub.getSummary(),
        stub.pendingOutbox(),
      ]);
      return {
        queueId,
        status: summary.status,
        waiting: summary.waiting,
        pendingOutbox,
      };
    }),
  );
  return {
    pushes: pushes.results,
    analytics: analytics.results,
    snapshots: snapshots.results.map((s) => ({
      ...s,
      isOpen: Boolean(s.isOpen),
      isPaused: Boolean(s.isPaused),
    })),
    queues,
    truncated,
  };
}

export interface D1TokenAudit {
  id: string;
  sessionId: string;
  number: number;
  series: string;
  state: string;
  userId: string | null;
  calledAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  rev: number;
}

/** DO dump and D1 token rows of one queue, for the invariant checker. */
export async function auditQueue(
  env: Env,
  queueId: string,
): Promise<{ do: AuditDump; d1Tokens: D1TokenAudit[] }> {
  const exists = await env.DB.prepare("SELECT 1 AS x FROM queues WHERE id = ?")
    .bind(queueId)
    .first();
  if (!exists) throw notFound();
  const [dump, rows] = await Promise.all([
    queueStub(env, queueId).auditTokens(),
    env.DB.prepare(
      `SELECT id, session_id AS sessionId, number, series, state, user_id AS userId,
         called_at AS calledAt, ended_at AS endedAt, end_reason AS endReason, rev
       FROM tokens WHERE queue_id = ? ORDER BY joined_at, id`,
    )
      .bind(queueId)
      .all<D1TokenAudit>(),
  ]);
  return { do: dump, d1Tokens: rows.results };
}

/** Tables wiped by reset, children first (business_members/queues → businesses). */
export const RESET_TABLES = [
  "push_tickets",
  "devices",
  "free_lane_strikes",
  "outbox_receipts",
  "analytics_hourly",
  "queue_snapshots",
  "tokens",
  "business_members",
  "queues",
  "businesses",
  "users",
] as const;

export type ResetResult =
  | { done: true; closedQueues: number; wiped: Record<string, number> }
  | { done: false; closedQueues: number; pendingOutbox: number };

/**
 * Closes every queue's session, then wipes the load-test tables once every
 * DO outbox is empty (otherwise a late outbox write would re-create rows after
 * the wipe). Returns `done: false` (409) while outboxes are still draining:
 * the caller retries.
 */
export async function resetLoadtest(env: Env): Promise<ResetResult> {
  const ids = await queueIds(env.DB);
  const batch = ids.slice(0, MAX_LOADTEST_QUEUES);
  const pending = await Promise.all(
    batch.map(async (queueId) => {
      const stub = queueStub(env, queueId);
      await stub.close();
      return stub.pendingOutbox();
    }),
  );
  const pendingOutbox = pending.reduce((a, b) => a + b, 0);
  if (pendingOutbox > 0 || ids.length > MAX_LOADTEST_QUEUES) {
    return { done: false, closedQueues: batch.length, pendingOutbox };
  }
  const results = await env.DB.batch(
    RESET_TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  const wiped: Record<string, number> = {};
  RESET_TABLES.forEach((t, i) => {
    wiped[t] = results[i]?.meta.changes ?? 0;
  });
  return { done: true, closedQueues: batch.length, wiped };
}
