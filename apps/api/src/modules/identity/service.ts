import type { MeResponse, UpdateMeBody } from "@qpeer/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { type User, users } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { newId } from "../../lib/ids";
import type { VerifiedUser } from "../../middleware/auth";

/**
 * Find or create the user for a verified token. Writes only when something changed,
 * and is safe when several first requests for the same uid arrive at once.
 *
 * `display_name` is user-editable (PATCH /v1/me), so the token's `name` claim only
 * fills it while it is still empty; it never overwrites a name the user chose.
 */
export async function upsertUser(
  db: Db,
  now: number,
  v: VerifiedUser,
): Promise<User> {
  const byUid = () =>
    db.select().from(users).where(eq(users.firebaseUid, v.uid)).get();

  let user = await byUid();
  if (!user) {
    const [created] = await db
      .insert(users)
      .values({
        id: newId(),
        firebaseUid: v.uid,
        isAnonymous: v.isAnonymous,
        phone: v.phone,
        email: v.email,
        displayName: v.name,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      })
      .onConflictDoNothing({ target: users.firebaseUid })
      .returning();
    // A concurrent first request may have won the insert: read theirs.
    user = created ?? (await byUid());
    if (!user) throw new Error("user upsert failed");
  }

  const fillName = user.displayName === null && v.name !== null;
  const changed =
    user.isAnonymous !== v.isAnonymous ||
    user.email !== v.email ||
    user.phone !== v.phone ||
    fillName;
  if (!changed) return user;

  const [updated] = await db
    .update(users)
    .set({
      isAnonymous: v.isAnonymous,
      email: v.email,
      phone: v.phone,
      ...(fillName ? { displayName: v.name } : {}),
      updatedAt: new Date(now),
    })
    .where(eq(users.id, user.id))
    .returning();
  return updated;
}

export function toMeResponse(user: User): MeResponse {
  return {
    user: {
      id: user.id,
      isAnonymous: Boolean(user.isAnonymous),
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      preferredMode: user.preferredMode ?? null,
    },
  };
}

/**
 * IDN-06: edit display name. IDN-08: remember the chosen app mode.
 * Business mode needs a registered user (403 `registration_required`).
 */
export async function updateMe(
  db: Db,
  now: number,
  user: User,
  body: UpdateMeBody,
): Promise<User> {
  if (body.preferredMode === "business" && user.isAnonymous) {
    throw new AppError(
      403,
      "registration_required",
      "Sign in with phone or Google to use Business mode",
    );
  }
  const [updated] = await db
    .update(users)
    .set({
      ...(body.displayName !== undefined
        ? { displayName: body.displayName }
        : {}),
      ...(body.preferredMode !== undefined
        ? { preferredMode: body.preferredMode }
        : {}),
      updatedAt: new Date(now),
    })
    .where(eq(users.id, user.id))
    .returning();
  return updated;
}
