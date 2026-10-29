import { db } from "../db/client";
import type { Bindings } from "../env";
import { BudgetSpent, CallBudget } from "../lib/call-budget";
import {
  checkPushReceipts,
  pushTransport,
} from "../modules/notifications/expo-push";
import {
  expireStaleOrders,
  processDueRefunds,
  reconcile,
  recoverRecentOrders,
} from "../modules/payments/service";
import { autoCloseQueues } from "../modules/queue/auto-close";

/**
 * Scheduled jobs (architecture doc §14). Cron expressions must match
 * `triggers.crons` in wrangler.jsonc. Handlers are thin and call services.
 */
export const CRON_HOURLY = "0 * * * *";
export const CRON_QUARTER_HOUR = "*/15 * * * *";
/** Daily at 03:00 IST (21:30 UTC). */
export const CRON_DAILY = "30 21 * * *";

/**
 * Outbound calls one scheduled run may make for payments: every Razorpay
 * call plus the `refund_issued` push of a refund. The free plan allows 50
 * external subrequests per invocation (D1 and DO bindings don't count); the
 * other 10 are headroom for the hourly push-receipt call and anything a
 * job adds later. Shared by all jobs of the run (§14, INC-064).
 */
export const CRON_CALL_BUDGET = 40;
/**
 * Calls kept for the daily `reconcile` when it runs with the quarter-hour
 * jobs (21:30 UTC): its provider scan runs once a day, so the urgent jobs
 * leave it this many (a few list pages plus some confirms).
 */
export const RECONCILE_RESERVE = 15;

interface JobEnv {
  DB: D1Database;
  QUEUE: Bindings["QUEUE"];
  /** `loadtest` swaps in the recording push sender (expo-push.ts). */
  ENVIRONMENT?: string;
  EXPO_ACCESS_TOKEN?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  TICKET_SIGNING_KEY?: string;
}

type Job = (env: JobEnv, now: number, budget: CallBudget) => Promise<unknown>;

/**
 * Jobs in the order they run. Payment work is ordered by urgency: recover
 * lost payments (a customer paid and has no ticket), then refunds, then the
 * daily provider scan.
 */
export const JOBS: Record<string, { name: string; run: Job }[]> = {
  [CRON_HOURLY]: [
    {
      name: "push_receipts",
      run: (env, now) => checkPushReceipts(env.DB, pushTransport(env), now),
    },
  ],
  [CRON_QUARTER_HOUR]: [
    // B20: close queues 30 min after their last hours range (safety net for
    // the DO's own alarm, see modules/queue/auto-close.ts).
    { name: "auto_close", run: (env) => autoCloseQueues(env) },
    // Step 4: unpaid orders expire after 30 min (§10.1).
    {
      name: "expire_orders",
      run: (env, now) => expireStaleOrders(db(env.DB), now),
    },
    // G3: paid orders whose webhook was lost and whose app never verified
    // (last 2 h), and captured payments still without a ticket.
    {
      name: "recover_orders",
      run: (env, now, budget) =>
        recoverRecentOrders({ db: db(env.DB), env, now, budget }),
    },
    // Step 4: refunds decided by a QueueDO (auto-close, validity, a failed
    // inline refund, a refund.failed webhook) are made here, with backoff.
    {
      name: "refunds",
      run: (env, now, budget) =>
        processDueRefunds({ db: db(env.DB), env, now, budget }, 40),
    },
  ],
  // Step 4: payment reconciliation (§10.4, PAY-12) + webhook id cleanup.
  [CRON_DAILY]: [
    {
      name: "reconcile",
      run: (env, now, budget) => reconcile(env, db(env.DB), now, budget),
    },
  ],
};

/**
 * The cron schedules whose jobs run for one trigger. The free plan allows 5
 * cron triggers per account, so each env registers only the quarter-hour one
 * and it also runs the hourly jobs at minute 0 and the daily jobs at 21:30
 * UTC (INC-056). A direct hourly/daily trigger still runs just its own jobs.
 */
export function dueSchedules(cron: string, now: number): string[] {
  if (cron !== CRON_QUARTER_HOUR) return [cron];
  const d = new Date(now);
  const due = [CRON_QUARTER_HOUR];
  if (d.getUTCMinutes() === 0) due.push(CRON_HOURLY);
  if (d.getUTCHours() === 21 && d.getUTCMinutes() === 30) due.push(CRON_DAILY);
  return due;
}

/** How much a job left for the next run (its result's `deferred`). */
function deferredOf(result: unknown): number {
  const d = (result as { deferred?: unknown } | null)?.deferred;
  return typeof d === "number" ? d : 0;
}

/**
 * Runs every job due for `cron`; one failing job doesn't stop the others.
 * All jobs share one call budget (`CRON_CALL_BUDGET`); when the daily
 * reconcile is due too, the other jobs leave it `RECONCILE_RESERVE` calls.
 * Work the budget can't pay for is left for the next run and reported once,
 * in one info line with the counts.
 */
export async function runScheduled(
  cron: string,
  env: JobEnv,
  now: number,
  callBudget = CRON_CALL_BUDGET,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const budget = new CallBudget(callBudget);
  const schedules = dueSchedules(cron, now);
  const urgent = schedules.includes(CRON_DAILY)
    ? budget.child(Math.max(0, callBudget - RECONCILE_RESERVE))
    : budget;
  const deferred: Record<string, number> = {};
  for (const c of schedules) {
    for (const job of JOBS[c] ?? []) {
      const share = c === CRON_DAILY ? budget : urgent;
      try {
        results[job.name] = await job.run(env, now, share);
        const left = deferredOf(results[job.name]);
        if (left > 0) deferred[job.name] = left;
        console.log(
          JSON.stringify({
            ts: new Date().toISOString(),
            cron,
            job: job.name,
            result: results[job.name],
          }),
        );
      } catch (e) {
        if (e instanceof BudgetSpent) {
          // A job that let it through: stopped cleanly, not an error.
          results[job.name] = { deferred: true };
          deferred[job.name] = deferred[job.name] ?? 1;
          continue;
        }
        results[job.name] = { error: true };
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            cron,
            job: job.name,
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }
  }
  if (Object.keys(deferred).length > 0) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "call_budget_used_up",
        cron,
        limit: callBudget,
        used: budget.spent,
        deferred,
      }),
    );
  }
  return results;
}
