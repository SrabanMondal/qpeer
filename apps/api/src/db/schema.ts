import type { QueueSettings, WeeklyHours } from "@qpeer/shared";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/*
 * Time convention: every timestamp column is INTEGER epoch milliseconds, declared
 * with `mode: "timestamp_ms"` (Drizzle maps it to a JS Date). API JSON exposes the
 * same instant as a number of epoch ms (`date.getTime()`). Never use `mode:
 * "timestamp"` (seconds). See docs/QPeer_v1_Backend_Architecture.md section 4.
 */
const ms = (name: string) => integer(name, { mode: "timestamp_ms" });

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull().unique(),
  isAnonymous: integer("is_anonymous", { mode: "boolean" }).notNull(),
  phone: text("phone"),
  email: text("email"),
  displayName: text("display_name"),
  /** Last mode chosen in the app (IDN-08); null = never chosen (app shows Customer). */
  preferredMode: text("preferred_mode", { enum: ["customer", "business"] }),
  /** Unused until Step 2 (free-lane no-show blocking). */
  freeLaneBlockedUntil: ms("free_lane_blocked_until"),
  createdAt: ms("created_at").notNull(),
  updatedAt: ms("updated_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const businesses = sqliteTable(
  "businesses",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    name: text("name").notNull(),
    category: text("category", {
      enum: ["clinic", "lab", "service_centre", "salon", "other"],
    }).notNull(),
    address: text("address").notNull(),
    phone: text("phone"),
    /** Null until the owner sets the pin (BIZ-03). */
    lat: real("lat"),
    lng: real("lng"),
    geohash: text("geohash"),
    hoursJson: text("hours_json", { mode: "json" })
      .$type<WeeklyHours>()
      .notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    index("businesses_status_lat_lng_idx").on(t.status, t.lat, t.lng),
    index("businesses_owner_user_id_idx").on(t.ownerUserId),
  ],
);

export type Business = typeof businesses.$inferSelect;

export const businessMembers = sqliteTable(
  "business_members",
  {
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["owner", "staff"] }).notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.businessId, t.userId] }),
    index("business_members_user_id_idx").on(t.userId),
  ],
);

export type BusinessMember = typeof businessMembers.$inferSelect;

export const queues = sqliteTable(
  "queues",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    status: text("status", { enum: ["active", "archived"] }).notNull(),
    settingsJson: text("settings_json", { mode: "json" })
      .$type<QueueSettings>()
      .notNull(),
    /** Incremented on every settings change; the QueueDO ignores older versions. */
    settingsVersion: integer("settings_version").notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [index("queues_business_id_idx").on(t.businessId)],
);

export type Queue = typeof queues.$inferSelect;
