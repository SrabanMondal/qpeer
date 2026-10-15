import type { BusinessRole } from "@qpeer/shared";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { type Db, db } from "../db/client";
import type { User } from "../db/schema";
import { businessMembers, queues } from "../db/schema";
import type { AppEnv } from "../env";
import { AppError, notFound } from "../lib/errors";

/** The signed-in user. Auth middleware guarantees it on every /v1 route except health. */
export function currentUser(c: { get(key: "user"): User | undefined }): User {
  const user = c.get("user");
  if (!user)
    throw new AppError(401, "unauthorized", "Missing or invalid token");
  return user;
}

/** IDN-10: anonymous users get 403 `registration_required`. */
export function requireRegistered() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = currentUser(c);
    if (user.isAnonymous) {
      throw new AppError(
        403,
        "registration_required",
        "Sign in with phone or Google to do this",
      );
    }
    await next();
  });
}

const RANK: Record<BusinessRole, number> = { staff: 1, owner: 2 };

/** The caller's role in a business, or null when not a member (or no such business). */
export async function findRole(
  database: Db,
  businessId: string,
  userId: string,
): Promise<BusinessRole | null> {
  const row = await database
    .select({ role: businessMembers.role })
    .from(businessMembers)
    .where(
      and(
        eq(businessMembers.businessId, businessId),
        eq(businessMembers.userId, userId),
      ),
    )
    .get();
  return row?.role ?? null;
}

/**
 * Requires the caller to hold at least `role` in the business named by the `:id`
 * route param. With `scope: "queue"`, `:id` is a queue id and the business is
 * resolved from it (so a member of business A can never act on business B).
 *
 * - Unknown business/queue, or no membership: 404 `not_found` (no existence leak).
 * - Member, but role too low: 403 `forbidden`.
 *
 * On success, `c.var.membership` holds `{ businessId, role }`.
 */
export function requireBusinessRole(
  role: BusinessRole,
  scope: "business" | "queue" = "business",
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = currentUser(c);
    const id = c.req.param("id");
    if (!id) throw notFound();
    const database = db(c.env.DB);

    let businessId: string = id;
    if (scope === "queue") {
      const queue = await database
        .select({ businessId: queues.businessId })
        .from(queues)
        .where(eq(queues.id, id))
        .get();
      if (!queue) throw notFound();
      businessId = queue.businessId;
    }

    // Membership rows only exist for existing businesses (FK), so this one lookup
    // answers both "does it exist" and "may this user see it" without telling them apart.
    const myRole = await findRole(database, businessId, user.id);
    if (!myRole) throw notFound();
    if (RANK[myRole] < RANK[role]) {
      throw new AppError(403, "forbidden", "Only the owner can do this");
    }

    c.set("membership", { businessId, role: myRole });
    await next();
  });
}

export function membership(c: {
  get(key: "membership"): AppEnv["Variables"]["membership"];
}) {
  const m = c.get("membership");
  if (!m) throw new Error("requireBusinessRole must run before this handler");
  return m;
}
