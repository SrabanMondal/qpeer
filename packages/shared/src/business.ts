import { z } from "zod";
import { LatLng } from "./geo";
import {
  DayHours,
  defaultWeeklyHours,
  WeekdaySchema,
  WeeklyHours,
} from "./hours";
import { QueueLiveSummary } from "./queue";
import { QueueSettings, QueueSettingsPatch } from "./queue-settings";

export const BusinessCategory = z.enum([
  "clinic",
  "lab",
  "service_centre",
  "salon",
  "other",
]);

export type BusinessCategory = z.infer<typeof BusinessCategory>;

export const BusinessStatus = z.enum(["active", "inactive"]);
export type BusinessStatus = z.infer<typeof BusinessStatus>;

export const BusinessRole = z.enum(["owner", "staff"]);
export type BusinessRole = z.infer<typeof BusinessRole>;

export const QueueStatus = z.enum(["active", "archived"]);
export type QueueStatus = z.infer<typeof QueueStatus>;

/** What a business still needs before it is listed on the map (BIZ-07). */
export const ListingRequirement = z.enum(["pin", "queue"]);
export type ListingRequirement = z.infer<typeof ListingRequirement>;

const BusinessName = z.string().trim().min(2).max(80);
const Address = z.string().trim().max(200);
const Phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ]{7,16}$/, "Expected a phone number");
const QueueName = z.string().trim().min(1).max(40);

/** POST /v1/businesses (BIZ-01). */
export const CreateBusinessBody = z
  .object({
    name: BusinessName,
    category: BusinessCategory,
    address: Address.default(""),
    phone: Phone.optional(),
    location: LatLng.optional(),
    hours: WeeklyHours.default(defaultWeeklyHours),
  })
  .strict();

export type CreateBusinessBody = z.infer<typeof CreateBusinessBody>;
export type CreateBusinessInput = z.input<typeof CreateBusinessBody>;

/** PATCH /v1/businesses/:id (BIZ-02, BIZ-04, BIZ-05). `phone: null` clears it. */
export const UpdateBusinessBody = z
  .object({
    name: BusinessName,
    category: BusinessCategory,
    address: Address,
    phone: Phone.nullable(),
    location: LatLng,
    hours: WeeklyHours,
    /** MAP-06: show public stats before the business has been listed for 14 days. */
    publicStats: z.boolean(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, {
    message: "At least one field is required",
  });

export type UpdateBusinessBody = z.infer<typeof UpdateBusinessBody>;

/** POST /v1/businesses/:id/queues (BIZ-10, BIZ-12). */
export const CreateQueueBody = z
  .object({
    name: QueueName,
    settings: QueueSettingsPatch.optional(),
  })
  .strict();

export type CreateQueueBody = z.infer<typeof CreateQueueBody>;

/** PATCH /v1/queues/:id (BIZ-11, BIZ-12). */
export const UpdateQueueBody = z
  .object({
    name: QueueName.optional(),
    settings: QueueSettingsPatch.optional(),
  })
  .strict()
  .refine((b) => b.name !== undefined || b.settings !== undefined, {
    message: "At least one of name or settings is required",
  });

export type UpdateQueueBody = z.infer<typeof UpdateQueueBody>;

export const QueueView = z.object({
  id: z.string(),
  businessId: z.string(),
  name: z.string(),
  status: QueueStatus,
  /** Present for owner/staff only. */
  settings: QueueSettings.optional(),
  /** Present for owner/staff only. */
  settingsVersion: z.number().int().optional(),
  /** Deep link encoded in the queue QR code: `qpeer://q/<id>`. */
  joinUrl: z.string(),
  /**
   * Map snapshot (≤ ~30 s old) in business views; null until the queue's first
   * snapshot is written. Absent in queue create/update responses.
   */
  live: QueueLiveSummary.nullable().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type QueueView = z.infer<typeof QueueView>;

/** Days of `analytics_hourly` behind the public stats (MAP-05). */
export const STATS_WINDOW_DAYS = 28;
/** A stat is null until it has at least this many samples. */
export const STATS_MIN_SAMPLES = 20;
/** Non-members see stats once the business has been listed this long, or earlier if the owner opts in (MAP-06). */
export const STATS_PUBLIC_AFTER_DAYS = 14;

/**
 * Public stats over the last 28 days (MAP-05), summed over the business's
 * queues. Each average is null with fewer than 20 samples behind it.
 */
export const BusinessStats = z.object({
  windowDays: z.number().int(),
  /** Tokens served in the window (always a count, even when small). */
  servedCount: z.number().int(),
  /** Average wait from joining to being called. */
  avgWaitMs: z.number().int().nullable(),
  /** Average time between calls (the service interval). */
  avgServiceMs: z.number().int().nullable(),
  /** Share of calls that happened inside the predicted wait range, 0–100. */
  etaAccuracyPct: z.number().int().nullable(),
});

export type BusinessStats = z.infer<typeof BusinessStats>;

/** Today's opening hours in IST, with display text ("9:00 AM – 6:00 PM" / "Closed today"). */
export const TodayHours = z.object({
  day: WeekdaySchema,
  ranges: DayHours,
  text: z.string(),
});

export type TodayHours = z.infer<typeof TodayHours>;

export const BusinessView = z.object({
  id: z.string(),
  name: z.string(),
  category: BusinessCategory,
  address: z.string(),
  phone: z.string().nullable(),
  location: LatLng.nullable(),
  hours: WeeklyHours,
  /** From `hours`, in Asia/Kolkata, at response time. */
  isOpenNow: z.boolean(),
  todayHours: TodayHours,
  status: BusinessStatus,
  listed: z.boolean(),
  /** Owner view only. */
  missingForListing: z.array(ListingRequirement).optional(),
  /** Members only: the owner's MAP-06 opt-in. */
  publicStats: z.boolean().optional(),
  /**
   * `GET /v1/businesses/:id` only (MAP-05/06). Null for non-members until the
   * business has been listed for 14 days, unless the owner opted in.
   */
  stats: BusinessStats.nullable().optional(),
  myRole: BusinessRole.nullable(),
  /** Members see every queue; others see active queues only. */
  queues: z.array(QueueView),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type BusinessView = z.infer<typeof BusinessView>;

export const MyBusinessesResponse = z.object({
  items: z.array(BusinessView),
});

export type MyBusinessesResponse = z.infer<typeof MyBusinessesResponse>;

/** GET /v1/queues/:id — public queue info + live summary from the QueueDO (JON-03). */
export const QueueInfoResponse = z.object({
  queue: QueueView,
  business: z.object({
    id: z.string(),
    name: z.string(),
    category: BusinessCategory,
    address: z.string(),
    location: LatLng.nullable(),
    status: BusinessStatus,
    listed: z.boolean(),
  }),
  myRole: BusinessRole.nullable(),
  live: QueueLiveSummary,
  /** Walk-in GPS radius; the only queue setting shown to non-members. */
  joinRadiusM: z.number().int(),
});

export type QueueInfoResponse = z.infer<typeof QueueInfoResponse>;

export function queueJoinUrl(queueId: string): string {
  return `qpeer://q/${queueId}`;
}
