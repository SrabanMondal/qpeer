import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../../env";
import { notFound } from "../../lib/errors";
import { LOADTEST_ENVIRONMENT } from "../../middleware/loadtest-auth";
import { auditQueue, loadtestStats, resetLoadtest } from "./service";

/**
 * Load-test helpers (Step 3.5). Invisible (404) unless `ENVIRONMENT` is exactly
 * `loadtest` AND the caller was verified by the load-test key — so a Firebase
 * user can't reach them even on the loadtest Worker.
 */
const requireLoadtest = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.env.ENVIRONMENT !== LOADTEST_ENVIRONMENT) throw notFound();
    if (c.get("authSource") !== "loadtest") throw notFound();
    await next();
  });

export const loadtestRoutes = new Hono<AppEnv>()
  .use("/loadtest/*", requireLoadtest())
  .get("/loadtest/stats", async (c) => c.json(await loadtestStats(c.env)))
  .get("/loadtest/queues/:id/audit", async (c) =>
    c.json(await auditQueue(c.env, c.req.param("id"))),
  )
  .post("/loadtest/reset", async (c) => {
    const r = await resetLoadtest(c.env);
    return c.json(r, r.done ? 200 : 409);
  });
