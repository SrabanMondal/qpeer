import {
  DemoHistoryBody,
  type DemoQueuesResponse,
  DemoResetBody,
  DemoSeedBody,
} from "@qpeer/shared";
import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { db } from "../../db/client";
import type { AppEnv } from "../../env";
import { AppError, notFound } from "../../lib/errors";
import { parseBody, parseOptionalBody } from "../../lib/validate";
import { DEMO_ENVIRONMENTS } from "../../middleware/demo-auth";
import { currentUser, requireRegistered } from "../../middleware/guards";
import { loadtestPass } from "../loadtest/service";
import {
  type DemoCtx,
  isDemoQueue,
  listDemoQueues,
  resetDemo,
  seedDemoBusiness,
  seedDemoHistory,
} from "./service";

/**
 * Demo tool routes (Step 5, DEM-01…06). 404 unless `ENVIRONMENT` is `demo`,
 * `dev` or `local` AND the caller was verified by the demo key, so a Firebase
 * user can never reach them, even on the demo Worker.
 */
const requireDemo = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!DEMO_ENVIRONMENTS.has(c.env.ENVIRONMENT)) throw notFound();
    if (c.get("authSource") !== "demo") throw notFound();
    await next();
  });

const ctx = (c: Context<AppEnv>): DemoCtx => ({
  db: db(c.env.DB),
  env: c.env,
  now: c.get("clock").now(),
});

export const demoRoutes = new Hono<AppEnv>()
  .use("/demo/*", requireDemo())
  // DEM-01: one catalogue business (idempotent); the caller becomes its owner.
  .post("/demo/seed", requireRegistered(), async (c) => {
    const body = await parseBody(c, DemoSeedBody);
    return c.json(await seedDemoBusiness(ctx(c), currentUser(c).id, body));
  })
  // DEM-02, DEM-03: replaces one business's synthetic history.
  .post("/demo/seed/history", async (c) => {
    const body = await parseBody(c, DemoHistoryBody);
    return c.json(await seedDemoHistory(ctx(c), body));
  })
  .get("/demo/queues", async (c) =>
    c.json({
      queues: await listDemoQueues(db(c.env.DB)),
    } satisfies DemoQueuesResponse),
  )
  // DEM-04: an occasional Priority Pass for a simulated customer, booked and
  // checked in on the DO without Razorpay (no payment row: not in Earnings).
  .post("/demo/queues/:id/priority-pass", async (c) => {
    const id = c.req.param("id");
    if (!isDemoQueue(id)) throw notFound();
    return c.json(await loadtestPass(c.env, id, currentUser(c).id), 201);
  })
  // DEM-05: wipe demo rows (or everything on `demo` with wipeAll).
  .post("/demo/reset", async (c) => {
    const body = await parseOptionalBody(c, DemoResetBody);
    if (body.wipeAll && !["demo", "local"].includes(c.env.ENVIRONMENT)) {
      throw new AppError(
        403,
        "forbidden",
        "wipeAll only runs on the demo environment",
      );
    }
    const r = await resetDemo(c.env, body.wipeAll);
    return c.json(r, r.done ? 200 : 409);
  });
