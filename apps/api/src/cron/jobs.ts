import type { Bindings } from "../env";
import {
  checkPushReceipts,
  pushTransport,
} from "../modules/notifications/expo-push";
import { autoCloseQueues } from "../modules/queue/auto-close";

/**
 * Scheduled jobs (architecture doc §14). Cron expressions must match
 * `triggers.crons` in wrangler.jsonc. Handlers are thin and call services.
 */
export const CRON_HOURLY = "0 * * * *";
export const CRON_QUARTER_HOUR = "*/15 * * * *";

interface JobEnv {
  DB: D1Database;
  QUEUE: Bindings["QUEUE"];
  /** `loadtest` swaps in the recording push sender (expo-push.ts). */
  ENVIRONMENT?: string;
  EXPO_ACCESS_TOKEN?: string;
}

type Job = (env: JobEnv, now: number) => Promise<unknown>;

export const JOBS: Record<string, { name: string; run: Job }[]> = {
  [CRON_HOURLY]: [
    {
      name: "push_receipts",
      run: (env, now) => checkPushReceipts(env.DB, pushTransport(env), now),
    },
  ],
  // Step 4: expire unpaid orders.
  [CRON_QUARTER_HOUR]: [
    // B20: close queues 30 min after their last hours range (safety net for
    // the DO's own alarm, see modules/queue/auto-close.ts).
    { name: "auto_close", run: (env) => autoCloseQueues(env) },
  ],
};

/** Runs every job for `cron`; one failing job doesn't stop the others. */
export async function runScheduled(
  cron: string,
  env: JobEnv,
  now: number,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const job of JOBS[cron] ?? []) {
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
