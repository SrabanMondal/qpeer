import { MapQuery } from "@qpeer/shared";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { parseQuery } from "../../lib/validate";
import { mapQuery } from "./service";

/**
 * GET /v1/map (MAP-01…04): any signed-in user, anonymous included. The response
 * carries nothing user-specific. The request log line records only the path,
 * never the query, so the box coordinates are not logged (NFR-10).
 */
export const mapRoutes = new Hono<AppEnv>().get("/map", async (c) => {
  const q = parseQuery(c, MapQuery);
  return c.json(await mapQuery(c.env.DB, q, c.get("clock").now()));
});
