import type { HealthResponse } from "@qpeer/shared";
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { errorBody, onError } from "./lib/errors";
import { type Clock, systemClock } from "./lib/time";
import {
  authMiddleware,
  type KeySource,
  type TokenVerifier,
} from "./middleware/auth";
import { requestContext } from "./middleware/request-context";
import { businessRoutes } from "./modules/business/routes";
import { devRoutes } from "./modules/dev/routes";
import { identityRoutes } from "./modules/identity/routes";
import { loadtestRoutes } from "./modules/loadtest/routes";
import { mapRoutes } from "./modules/map/routes";
import { notificationRoutes } from "./modules/notifications/routes";
import { queueRoutes } from "./modules/queue/routes";

export type { AppEnv } from "./env";

export interface AppDeps {
  /** Token verifier override (tests use a local RS256 key). */
  verifier?: TokenVerifier;
  /** Clock override (tests control time). */
  clock?: Clock;
  /**
   * Firebase key source for the environment-selected verifier (tests only).
   * Unlike `verifier`, this keeps the per-environment selection (loadtest).
   */
  firebaseKeys?: KeySource;
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
  // `serverTime` lets the app measure the phone's clock offset (B9).
  app.get("/v1/health", (c) =>
    c.json({
      ok: true,
      env: c.env.ENVIRONMENT,
      serverTime: c.get("clock").now(),
    } satisfies HealthResponse),
  );

  // Everything else under /v1 needs a valid Firebase ID token.
  app.use(
    "/v1/*",
    authMiddleware({
      verifier: deps?.verifier,
      firebaseKeys: deps?.firebaseKeys,
    }),
  );
  app.route("/v1", identityRoutes);
  app.route("/v1", businessRoutes);
  app.route("/v1", mapRoutes);
  app.route("/v1", queueRoutes);
  app.route("/v1", notificationRoutes);
  app.route("/v1", devRoutes);
  app.route("/v1", loadtestRoutes);

  return app;
}
