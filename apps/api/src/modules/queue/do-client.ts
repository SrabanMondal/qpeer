import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Bindings } from "../../env";
import { AppError } from "../../lib/errors";
import type { DoErrorCode, DoResult } from "../../queue/queue-do";

/** The QueueDO for a queue (one per queue, addressed by name = queue id). */
export function queueStub(env: Pick<Bindings, "QUEUE">, queueId: string) {
  return env.QUEUE.get(env.QUEUE.idFromName(queueId));
}

const STATUS: Record<DoErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  invalid_state: 409,
  queue_closed: 409,
  queue_paused: 409,
  queue_full: 409,
  already_in_queue: 409,
  device_in_queue: 409,
  quota_full: 409,
  conflict: 409,
};

/** Returns the value of a DO result or throws the matching AppError (§7). */
export function unwrap<T>(r: DoResult<T>): T {
  if (r.ok) return r.value;
  throw new AppError(STATUS[r.code], r.code, r.message, r.details);
}
