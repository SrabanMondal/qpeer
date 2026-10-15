import {
  CreateBusinessBody,
  CreateQueueBody,
  UpdateBusinessBody,
  UpdateQueueBody,
} from "@qpeer/shared";
import { type Context, Hono } from "hono";
import { db } from "../../db/client";
import type { AppEnv } from "../../env";
import { parseBody } from "../../lib/validate";
import {
  currentUser,
  membership,
  requireBusinessRole,
  requireRegistered,
} from "../../middleware/guards";
import * as service from "./service";

const ctx = (c: Context<AppEnv>): service.ServiceCtx => ({
  db: db(c.env.DB),
  now: c.get("clock").now(),
});

const ownerOfBusiness = [
  requireRegistered(),
  requireBusinessRole("owner", "business"),
] as const;
const ownerOfQueue = [
  requireRegistered(),
  requireBusinessRole("owner", "queue"),
] as const;

export const businessRoutes = new Hono<AppEnv>()
  .post("/businesses", requireRegistered(), async (c) => {
    const body = await parseBody(c, CreateBusinessBody);
    const view = await service.createBusiness(ctx(c), currentUser(c).id, body);
    return c.json(view, 201);
  })
  .get("/me/businesses", requireRegistered(), async (c) => {
    const items = await service.listMyBusinesses(
      db(c.env.DB),
      currentUser(c).id,
    );
    return c.json({ items });
  })
  .get("/businesses/:id", async (c) => {
    const view = await service.getBusinessForViewer(
      db(c.env.DB),
      c.req.param("id"),
      currentUser(c).id,
    );
    return c.json(view);
  })
  .patch("/businesses/:id", ...ownerOfBusiness, async (c) => {
    const body = await parseBody(c, UpdateBusinessBody);
    const view = await service.updateBusiness(
      ctx(c),
      membership(c).businessId,
      body,
    );
    return c.json(view);
  })
  .post("/businesses/:id/deactivate", ...ownerOfBusiness, async (c) => {
    const view = await service.setBusinessStatus(
      ctx(c),
      membership(c).businessId,
      "inactive",
    );
    return c.json(view);
  })
  .post("/businesses/:id/activate", ...ownerOfBusiness, async (c) => {
    const view = await service.setBusinessStatus(
      ctx(c),
      membership(c).businessId,
      "active",
    );
    return c.json(view);
  })
  .post("/businesses/:id/queues", ...ownerOfBusiness, async (c) => {
    const body = await parseBody(c, CreateQueueBody);
    const view = await service.createQueue(
      ctx(c),
      membership(c).businessId,
      body,
    );
    return c.json(view, 201);
  })
  .get("/queues/:id", async (c) => {
    const info = await service.getQueueInfo(
      db(c.env.DB),
      c.req.param("id"),
      currentUser(c).id,
    );
    return c.json(info);
  })
  .patch("/queues/:id", ...ownerOfQueue, async (c) => {
    const body = await parseBody(c, UpdateQueueBody);
    const view = await service.updateQueue(ctx(c), c.req.param("id"), body);
    return c.json(view);
  })
  .post("/queues/:id/archive", ...ownerOfQueue, async (c) => {
    const view = await service.archiveQueue(ctx(c), c.req.param("id"));
    return c.json(view);
  });
