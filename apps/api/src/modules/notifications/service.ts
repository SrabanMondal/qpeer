import type { DeviceBody } from "@qpeer/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { devices } from "../../db/schema";

/**
 * ALR-02: register/refresh an Expo push token. Upsert by token: a token seen
 * under another user (shared phone, re-login) moves to the current user.
 */
export async function upsertDevice(
  db: Db,
  userId: string,
  body: DeviceBody,
  now: number,
): Promise<void> {
  const at = new Date(now);
  await db
    .insert(devices)
    .values({
      expoPushToken: body.expoPushToken,
      userId,
      platform: body.platform,
      deviceHash: body.deviceHash ?? null,
      lastSeenAt: at,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: devices.expoPushToken,
      set: {
        userId: sql`excluded.user_id`,
        platform: sql`excluded.platform`,
        deviceHash: sql`coalesce(excluded.device_hash, ${devices.deviceHash})`,
        lastSeenAt: sql`excluded.last_seen_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

/** ALR-02: remove on sign-out. Only the caller's own row; always succeeds. */
export async function deleteDevice(
  db: Db,
  userId: string,
  expoPushToken: string,
): Promise<void> {
  await db
    .delete(devices)
    .where(
      and(eq(devices.expoPushToken, expoPushToken), eq(devices.userId, userId)),
    );
}
