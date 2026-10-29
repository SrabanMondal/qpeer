import { db } from "../db/client";
import type { Bindings } from "../env";
import {
  checkPushReceipts,
  pushTransport,
} from "../modules/notifications/expo-push";
import {
  expireStaleOrders,
  processDueRefunds,
  reconcile,
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

type Job = (env: JobEnv, now: number) => Promise<unknown>;

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
    // Step 4: refunds decided by a QueueDO (auto-close, validity, a failed
    // inline refund) are made here.
    {
      name: "refunds",
      run: (env, now) => processDueRefunds({ db: db(env.DB), env, now }, 40),
    },
  ],
  // Step 4: payment reconciliation (§10.4, PAY-12) + webhook id cleanup.
  [CRON_DAILY]: [
    { name: "reconcile", run: (env, now) => reconcile(env, db(env.DB), now) },
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

/** Runs every job due for `cron`; one failing job doesn't stop the others. */
export async function runScheduled(
  cron: string,
  env: JobEnv,
  now: number,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const jobs = dueSchedules(cron, now).flatMap((c) => JOBS[c] ?? []);
  for (const job of jobs) {
    try {
      results[job.name] = await job.run(env, now);
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          cron,
          job: job.name,
          result: results[job.name],
        }),
      );
    } catch (e) {
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
  return results;
}
