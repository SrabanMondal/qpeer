import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import type { Clock } from "../lib/time";

/** Request id (also sent as `x-request-id`), clock, and one JSON log line per request. */
export function requestContext(clock: Clock) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const start = Date.now();
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.set("clock", clock);
    c.header("x-request-id", requestId);

    try {
      await next();
    } finally {
      const log: Record<string, unknown> = {
        ts: new Date().toISOString(),
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Date.now() - start,
      };
      const userId = c.get("userId");
      if (userId) log.userId = userId;
      const code = c.get("errorCode");
      if (code) log.code = code;
      console.log(JSON.stringify(log));
    }
  });
}
