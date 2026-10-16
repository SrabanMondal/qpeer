import {
  checkPushReceipts,
  pushTransport,
} from "../modules/notifications/expo-push";

/**
 * Scheduled jobs (architecture doc §14). Cron expressions must match
 * `triggers.crons` in wrangler.jsonc. Handlers are thin and call services.
 */
export const CRON_HOURLY = "0 * * * *";
export const CRON_QUARTER_HOUR = "*/15 * * * *";

interface JobEnv {
  DB: D1Database;
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
  // Step 4: expire unpaid orders. Later: auto-close queues past closing time.
  [CRON_QUARTER_HOUR]: [],
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
