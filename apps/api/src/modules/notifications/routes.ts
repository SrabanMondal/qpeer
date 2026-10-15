import { DeviceBody } from "@qpeer/shared";
import { Hono } from "hono";
import { db } from "../../db/client";
import type { AppEnv } from "../../env";
import { parseBody } from "../../lib/validate";
import { currentUser } from "../../middleware/guards";
import { deleteDevice, upsertDevice } from "./service";

export const notificationRoutes = new Hono<AppEnv>()
  .post("/me/devices", async (c) => {
    const body = await parseBody(c, DeviceBody);
    await upsertDevice(
      db(c.env.DB),
      currentUser(c).id,
      body,
      c.get("clock").now(),
    );
    return c.json({ ok: true as const });
  })
  .delete("/me/devices/:pushToken", async (c) => {
    await deleteDevice(
      db(c.env.DB),
      currentUser(c).id,
      c.req.param("pushToken"),
    );
    return c.json({ ok: true as const });
  });
