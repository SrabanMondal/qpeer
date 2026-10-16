import type { WeeklyHours } from "@qpeer/shared";
import type { Bindings } from "../../env";
import { queueStub } from "./do-client";

/**
 * B20 (INC-047) safety net, run by the 15-minute cron. Each QueueDO closes
 * its own session on its alarm at the auto-close time (30 min after the
 * day's last hours range, later after "Keep open"), but only once it knows
 * the hours. This job hands every open queue its business hours and closes
 * the ones that are overdue, e.g. sessions opened before this code was
 * deployed or DOs that never got the hours.
 *
 * Open queues come from the D1 snapshots. At most `MAX_QUEUES_PER_RUN`
 * DO calls per run (stalest snapshots first) to stay inside the free plan's
 * subrequest limit; the rest are reached by later runs and their own alarms.
 */
export const MAX_QUEUES_PER_RUN = 40;

interface Row {
  queue_id: string;
  hours_json: string;
}

export async function autoCloseQueues(
  env: Pick<Bindings, "DB" | "QUEUE">,
): Promise<{ checked: number; closed: number; failed: number }> {
  const { results } = await env.DB.prepare(
    `SELECT s.queue_id, b.hours_json
     FROM queue_snapshots s
     JOIN queues q ON q.id = s.queue_id AND q.status = 'active'
     JOIN businesses b ON b.id = q.business_id
     WHERE s.is_open = 1
     ORDER BY s.updated_at
     LIMIT ?`,
  )
    .bind(MAX_QUEUES_PER_RUN)
    .all<Row>();
  let closed = 0;
  let failed = 0;
  for (const r of results) {
    try {
      const hours = JSON.parse(r.hours_json) as WeeklyHours;
      const res = await queueStub(env, r.queue_id).autoCloseCheck(hours);
      if (res.closed) closed++;
    } catch (e) {
      failed++;
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          where: "cron.auto_close",
          queueId: r.queue_id,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }
  return { checked: results.length, closed, failed };
}
