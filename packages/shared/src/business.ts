import { z } from "zod";
import { LatLng } from "./geo";
import { defaultWeeklyHours, WeeklyHours } from "./hours";
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
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export type QueueView = z.infer<typeof QueueView>;

export const BusinessView = z.object({
  id: z.string(),
  name: z.string(),
  category: BusinessCategory,
  address: z.string(),
  phone: z.string().nullable(),
  location: LatLng.nullable(),
  hours: WeeklyHours,
  status: BusinessStatus,
  listed: z.boolean(),
  /** Owner view only. */
  missingForListing: z.array(ListingRequirement).optional(),
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

/** GET /v1/queues/:id — public queue info (JON-03). Live summary comes in Step 2. */
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
});

export type QueueInfoResponse = z.infer<typeof QueueInfoResponse>;

export function queueJoinUrl(queueId: string): string {
  return `qpeer://q/${queueId}`;
}
