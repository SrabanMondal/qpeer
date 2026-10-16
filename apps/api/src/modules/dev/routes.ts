import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { db } from "../../db/client";
import type { AppEnv } from "../../env";
import { notFound } from "../../lib/errors";
import { requireRegistered } from "../../middleware/guards";
import { seedMap, unseedMap } from "./seed-map";

/** Environments where dev helpers exist; everywhere else (demo, unknown) they are 404. */
const DEV_ENVIRONMENTS = new Set(["local", "dev"]);

/** Dev helpers are invisible (404) outside `local` and `dev`. */
const requireDevEnv = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!DEV_ENVIRONMENTS.has(c.env.ENVIRONMENT)) throw notFound();
    await next();
  });

export const devRoutes = new Hono<AppEnv>()
  .use("/dev/*", requireDevEnv())
  .get("/dev/queue-ping/:queueId", async (c) => {
    const stub = c.env.QUEUE.get(
      c.env.QUEUE.idFromName(c.req.param("queueId")),
    );
    return c.json(await stub.ping());
  })
  // Step 3: demo businesses around Jammu for trying the map (idempotent).
  .post("/dev/seed-map", requireRegistered(), async (c) =>
    c.json(
      await seedMap({
        db: db(c.env.DB),
        env: c.env,
        now: c.get("clock").now(),
      }),
    ),
  )
  .post("/dev/unseed-map", requireRegistered(), async (c) =>
    c.json(await unseedMap({ db: db(c.env.DB), env: c.env })),
  );
