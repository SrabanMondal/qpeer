import { Hono } from "hono";
import type { AppEnv } from "./env";
import { errorBody, onError } from "./lib/errors";
import { type Clock, systemClock } from "./lib/time";
import { authMiddleware, type TokenVerifier } from "./middleware/auth";
import { requestContext } from "./middleware/request-context";
import { businessRoutes } from "./modules/business/routes";
import { devRoutes } from "./modules/dev/routes";
import { identityRoutes } from "./modules/identity/routes";
import { notificationRoutes } from "./modules/notifications/routes";
import { queueRoutes } from "./modules/queue/routes";

export type { AppEnv } from "./env";

export interface AppDeps {
  /** Token verifier override (tests use a local RS256 key). */
  verifier?: TokenVerifier;
  /** Clock override (tests control time). */
  clock?: Clock;
}

export function createApp(deps?: AppDeps) {
  const app = new Hono<AppEnv>();

  app.onError(onError);
  app.notFound((c) => {
    c.set("errorCode", "not_found");
    return c.json(errorBody(c, "not_found", "Not found"), 404);
  });

  app.use("*", requestContext(deps?.clock ?? systemClock));

  // Public routes (no token).
  app.get("/v1/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT }));

  // Everything else under /v1 needs a valid Firebase ID token.
  app.use("/v1/*", authMiddleware(deps?.verifier));
  app.route("/v1", identityRoutes);
  app.route("/v1", businessRoutes);
  app.route("/v1", queueRoutes);
  app.route("/v1", notificationRoutes);
  app.route("/v1", devRoutes);

  return app;
}
