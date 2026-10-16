import { z } from "zod";

/** App mode (IDN-08). Only registered users may choose `business`. */
export const AppMode = z.enum(["customer", "business"]);

export type AppMode = z.infer<typeof AppMode>;

export const DisplayName = z.string().trim().min(1).max(60);

export const MeResponse = z.object({
  user: z.object({
    id: z.string(),
    isAnonymous: z.boolean(),
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    /** Null until the user picks a mode; the app then shows Customer mode. */
    preferredMode: AppMode.nullable(),
  }),
});

export type MeResponse = z.infer<typeof MeResponse>;

/** PATCH /v1/me (IDN-06, IDN-08). At least one field is required. */
export const UpdateMeBody = z
  .object({
    displayName: DisplayName.optional(),
    preferredMode: AppMode.optional(),
  })
  .strict()
  .refine((b) => b.displayName !== undefined || b.preferredMode !== undefined, {
    message: "At least one of displayName or preferredMode is required",
  });

export type UpdateMeBody = z.infer<typeof UpdateMeBody>;

/** Error codes from the backend architecture doc, section 7. */
export const ErrorCode = z.enum([
  "invalid_input",
  "unauthorized",
  "forbidden",
  "registration_required",
  "not_found",
  "conflict",
  "already_in_queue",
  /** C2: another account on this phone already holds a walk-in ticket here. */
  "device_in_queue",
  "queue_closed",
  "queue_paused",
  "queue_full",
  "quota_full",
  "invalid_state",
  "too_far",
  "mock_location",
  "no_location_fix",
  "free_lane_blocked",
  "rate_limited",
  "payment_provider_error",
  "internal",
]);

export type ErrorCode = z.infer<typeof ErrorCode>;

/** One entry of `details` for `invalid_input` errors. */
export const ValidationIssue = z.object({
  path: z.string(),
  message: z.string(),
});

export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const ErrorResponse = z.object({
  error: ErrorCode,
  message: z.string().optional(),
  requestId: z.string().optional(),
  details: z.unknown().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponse>;
