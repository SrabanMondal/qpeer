import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  makeFirebaseVerifier,
  type TokenVerifier,
  type VerifiedUser,
} from "./auth";
import { type User, users } from "./db/schema";
import type { QueueDO } from "./queue-do";

export interface AppContext {
  Bindings: {
    DB: D1Database;
    QUEUE: DurableObjectNamespace<QueueDO>;
    FIREBASE_PROJECT_ID: string;
    ENVIRONMENT: string;
  };
  Variables: {
    requestId: string;
    userId?: string;
    user?: User;
  };
}

type Db = ReturnType<typeof drizzle>;

/**
 * Find or create the user for a verified token. Writes only when something changed,
 * and is safe when several first requests for the same uid arrive at once.
 */
async function upsertUser(db: Db, v: VerifiedUser): Promise<User> {
  const byUid = () =>
    db.select().from(users).where(eq(users.firebaseUid, v.uid)).get();

  let user = await byUid();
  if (!user) {
    const now = new Date();
    await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        firebaseUid: v.uid,
        isAnonymous: v.isAnonymous,
        phone: v.phone,
        email: v.email,
        displayName: v.name,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: users.firebaseUid });
    user = await byUid();
    if (!user) throw new Error("user upsert failed");
  }

  const changed =
    user.isAnonymous !== v.isAnonymous ||
    user.email !== v.email ||
    user.phone !== v.phone ||
    user.displayName !== v.name;
  if (!changed) return user;

  const [updated] = await db
    .update(users)
    .set({
      isAnonymous: v.isAnonymous,
      email: v.email,
      phone: v.phone,
      displayName: v.name,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();
  return updated;
}

export function createApp(deps?: { verifier?: TokenVerifier }) {
  const app = new Hono<AppContext>();

  app.onError((err, c) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        requestId: c.get("requestId"),
        level: "error",
        message: err.message,
      }),
    );
    return c.json({ error: "internal", requestId: c.get("requestId") }, 500);
  });

  // Request ID and structured JSON logging middleware
  app.use("*", async (c, next) => {
    const start = Date.now();
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);

    try {
      await next();
    } finally {
      const ms = Date.now() - start;
      const userId = c.get("userId");
      const logEntry: Record<string, unknown> = {
        ts: new Date().toISOString(),
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms,
      };
      if (userId) {
        logEntry.userId = userId;
      }
      console.log(JSON.stringify(logEntry));
    }
  });

  const routes = app
    .get("/v1/health", (c) => {
      return c.json({ ok: true, env: c.env.ENVIRONMENT });
    })
    .use("/v1/*", async (c, next) => {
      const authHeader = c.req.header("Authorization");
      const requestId = c.get("requestId");

      if (!authHeader?.startsWith("Bearer ")) {
        return c.json({ error: "unauthorized", requestId }, 401);
      }

      const token = authHeader.slice(7).trim();
      if (!token) {
        return c.json({ error: "unauthorized", requestId }, 401);
      }

      if (!deps?.verifier && !c.env.FIREBASE_PROJECT_ID?.trim()) {
        throw new Error("FIREBASE_PROJECT_ID is not configured");
      }
      const verifier =
        deps?.verifier ?? makeFirebaseVerifier(c.env.FIREBASE_PROJECT_ID);

      // Only verification failures are 401. Database errors propagate to onError (500).
      let verifiedUser: VerifiedUser;
      try {
        verifiedUser = await verifier(token);
      } catch {
        // Never log the token
        return c.json({ error: "unauthorized", requestId }, 401);
      }

      const user = await upsertUser(drizzle(c.env.DB), verifiedUser);
      c.set("userId", user.id);
      c.set("user", user);
      await next();
    })
    .get("/v1/me", (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(
          { error: "unauthorized", requestId: c.get("requestId") },
          401,
        );
      }
      return c.json({
        user: {
          id: user.id,
          isAnonymous: Boolean(user.isAnonymous),
          displayName: user.displayName,
          email: user.email,
          phone: user.phone,
        },
      });
    })
    .get("/v1/dev/queue-ping/:queueId", async (c) => {
      const requestId = c.get("requestId");
      if (c.env.ENVIRONMENT === "demo") {
        return c.json({ error: "not_found", requestId }, 404);
      }

      const queueId = c.req.param("queueId");
      const id = c.env.QUEUE.idFromName(queueId);
      const stub = c.env.QUEUE.get(id);
      const result = await stub.ping();
      return c.json(result);
    });

  return routes;
}

const routes = createApp();
export type AppType = typeof routes;
