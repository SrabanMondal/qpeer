import { JoinBody, MyTokensQuery, NextBody } from "@qpeer/shared";
import { type Context, Hono } from "hono";
import { db } from "../../db/client";
import type { AppEnv } from "../../env";
import { AppError } from "../../lib/errors";
import { parseBody, parseOptionalBody, parseQuery } from "../../lib/validate";
import { currentUser, requireBusinessRole } from "../../middleware/guards";
import { queueStub } from "./do-client";
import * as service from "./service";

const ctx = (c: Context<AppEnv>): service.QueueCtx => ({
  db: db(c.env.DB),
  env: c.env,
  now: c.get("clock").now(),
});

/** Console routes: staff (or owner) of the queue's business; others get 404. */
const staffOfQueue = requireBusinessRole("staff", "queue");

const tokenActions = ["skip", "no-show", "admit", "served"] as const;
const queueActions = ["pause", "resume", "undo-next"] as const;

const routes = new Hono<AppEnv>()
  // ----- console -----
  .post("/queues/:id/open", staffOfQueue, async (c) =>
    c.json(await service.openQueue(ctx(c), c.req.param("id"))),
  )
  .post("/queues/:id/close", staffOfQueue, async (c) =>
    c.json(await service.closeQueue(ctx(c), c.req.param("id"))),
  )
  .post("/queues/:id/next", staffOfQueue, async (c) => {
    const body = await parseOptionalBody(c, NextBody);
    return c.json(
      await service.nextToken(ctx(c), c.req.param("id"), body.counter),
    );
  })
  .post("/queues/:id/triage", staffOfQueue, async (c) =>
    c.json(await service.insertTriage(ctx(c), c.req.param("id")), 201),
  )
  .get("/queues/:id/console", staffOfQueue, async (c) =>
    c.json(await service.getConsole(ctx(c), c.req.param("id"))),
  );

for (const action of queueActions) {
  routes.post(`/queues/:id/${action}`, staffOfQueue, async (c) =>
    c.json(await service.consoleAction(ctx(c), c.req.param("id"), action)),
  );
}
for (const action of tokenActions) {
  routes.post(`/queues/:id/tokens/:tid/${action}`, staffOfQueue, async (c) =>
    c.json(
      await service.consoleAction(
        ctx(c),
        c.req.param("id"),
        action,
        c.req.param("tid"),
      ),
    ),
  );
}

routes
  // ----- join -----
  .post("/queues/:id/join", async (c) => {
    const body = await parseBody(c, JoinBody);
    const token = await service.joinQueue(
      ctx(c),
      currentUser(c),
      c.req.param("id"),
      body,
    );
    return c.json(token, 201);
  })
  // ----- live -----
  .get("/queues/:id/live", async (c) => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      throw new AppError(400, "invalid_input", "Expected a WebSocket upgrade");
    }
    const queueId = c.req.param("id");
    const url = await service.authorizeLive(
      ctx(c),
      queueId,
      currentUser(c).id,
      { tokenId: c.req.query("tokenId"), console: c.req.query("console") },
    );
    // Forward only the upgrade (no Authorization header) to the DO.
    return queueStub(c.env, queueId).fetch(
      new Request(url, { headers: { Upgrade: "websocket" } }),
    );
  })
  // ----- tokens -----
  .get("/me/tokens", async (c) => {
    const q = parseQuery(c, MyTokensQuery);
    const items = await service.myTokens(
      db(c.env.DB),
      currentUser(c).id,
      q.status,
    );
    return c.json({ items });
  })
  .get("/tokens/:id", async (c) =>
    c.json(
      await service.getToken(ctx(c), c.req.param("id"), currentUser(c).id),
    ),
  )
  .post("/tokens/:id/leave", async (c) =>
    c.json(
      await service.leaveToken(ctx(c), c.req.param("id"), currentUser(c).id),
    ),
  )
  .post("/tokens/:id/cancel", async (c) =>
    c.json(
      await service.cancelToken(ctx(c), c.req.param("id"), currentUser(c).id),
    ),
  );

export const queueRoutes = routes;
