import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../../env";
import { notFound } from "../../lib/errors";

/** Dev helpers are invisible (404) in the demo environment. */
const requireDevEnv = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.env.ENVIRONMENT === "demo") throw notFound();
    await next();
  });

export const devRoutes = new Hono<AppEnv>()
  .use("/dev/*", requireDevEnv())
  .get("/dev/queue-ping/:queueId", async (c) => {
    const stub = c.env.QUEUE.get(
      c.env.QUEUE.idFromName(c.req.param("queueId")),
    );
    return c.json(await stub.ping());
  });
