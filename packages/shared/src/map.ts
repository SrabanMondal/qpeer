import { z } from "zod";
import { BusinessCategory } from "./business";
import { LatLng } from "./geo";

/** Largest bounding box side `GET /v1/map` accepts, in degrees (~165 km). */
export const MAP_MAX_BOX_DEG = 1.5;
export const MAP_DEFAULT_LIMIT = 200;
export const MAP_MAX_LIMIT = 300;

const Lat = z.coerce.number().finite().min(-90).max(90);
const Lng = z.coerce.number().finite().min(-180).max(180);

/**
 * GET /v1/map query (MAP-01…04). Values arrive as strings. `openNow=1` keeps
 * only businesses open now by their hours (Asia/Kolkata).
 */
export const MapQuery = z
  .object({
    minLat: Lat,
    minLng: Lng,
    maxLat: Lat,
    maxLng: Lng,
    category: BusinessCategory.optional(),
    openNow: z
      .enum(["1", "0", "true", "false"])
      .optional()
      .transform((v) => v === "1" || v === "true"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAP_MAX_LIMIT)
      .default(MAP_DEFAULT_LIMIT),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.minLat > q.maxLat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "minLat must not be greater than maxLat",
        path: ["maxLat"],
      });
    } else if (q.maxLat - q.minLat > MAP_MAX_BOX_DEG) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Box is larger than ${MAP_MAX_BOX_DEG}° of latitude`,
        path: ["maxLat"],
      });
    }
    if (q.minLng > q.maxLng) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "minLng must not be greater than maxLng",
        path: ["maxLng"],
      });
    } else if (q.maxLng - q.minLng > MAP_MAX_BOX_DEG) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Box is larger than ${MAP_MAX_BOX_DEG}° of longitude`,
        path: ["maxLng"],
      });
    }
  });

export type MapQuery = z.infer<typeof MapQuery>;
export type MapQueryInput = z.input<typeof MapQuery>;

/** One active queue of a map business, from its D1 snapshot (≤ ~30 s old). */
export const MapQueue = z.object({
  id: z.string(),
  name: z.string(),
  /** False when the queue has never been opened (no snapshot yet). */
  isOpen: z.boolean(),
  isPaused: z.boolean(),
  waiting: z.number().int(),
  /** Wait range (duration) for someone joining now; null while closed. */
  waitLowMs: z.number().int().nullable(),
  waitHighMs: z.number().int().nullable(),
  /** Snapshot time; null when there is no snapshot yet. */
  updatedAt: z.number().int().nullable(),
});

export type MapQueue = z.infer<typeof MapQueue>;

export const MapBusiness = z.object({
  id: z.string(),
  name: z.string(),
  category: BusinessCategory,
  address: z.string(),
  location: LatLng,
  /** From the business hours, in Asia/Kolkata, at response time. */
  isOpenNow: z.boolean(),
  queues: z.array(MapQueue),
  summary: z.object({
    /** People waiting, over all queues. */
    waiting: z.number().int(),
    /** Wait range of the open, not paused queue with the shortest wait; null if none. */
    waitLowMs: z.number().int().nullable(),
    waitHighMs: z.number().int().nullable(),
    /** At least one queue has an open session. */
    anyOpen: z.boolean(),
  }),
});

export type MapBusiness = z.infer<typeof MapBusiness>;

/** GET /v1/map. `truncated` = more listed businesses match than `limit`; zoom in. */
export const MapResponse = z.object({
  items: z.array(MapBusiness),
  truncated: z.boolean(),
  serverTime: z.number().int(),
});

export type MapResponse = z.infer<typeof MapResponse>;
