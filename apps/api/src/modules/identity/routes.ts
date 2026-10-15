import { UpdateMeBody } from "@qpeer/shared";
import { Hono } from "hono";
import { db } from "../../db/client";
import type { AppEnv } from "../../env";
import { parseBody } from "../../lib/validate";
import { currentUser } from "../../middleware/guards";
import { toMeResponse, updateMe } from "./service";

export const identityRoutes = new Hono<AppEnv>()
  .get("/me", (c) => c.json(toMeResponse(currentUser(c))))
  .patch("/me", async (c) => {
    const body = await parseBody(c, UpdateMeBody);
    const user = await updateMe(
      db(c.env.DB),
      c.get("clock").now(),
      currentUser(c),
      body,
    );
    return c.json(toMeResponse(user));
  });
