import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../../env";
import { notFound } from "../../lib/errors";
import { currentUser } from "../../middleware/guards";
import { LOADTEST_ENVIRONMENT } from "../../middleware/loadtest-auth";
import {
  auditQueue,
  loadtestPass,
  loadtestStats,
  resetLoadtest,
} from "./service";

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
  // Step 4: a checked-in Priority Pass for the caller without Razorpay (the
  // load test can't pay), so the run exercises the priority lane + credits.
  .post("/loadtest/queues/:id/priority-pass", async (c) =>
    c.json(
      await loadtestPass(c.env, c.req.param("id"), currentUser(c).id),
      201,
    ),
  )
  .post("/loadtest/reset", async (c) => {
    const r = await resetLoadtest(c.env);
    return c.json(r, r.done ? 200 : 409);
  });
