import { z } from "zod";

export const MeResponse = z.object({
  user: z.object({
    id: z.string(),
    isAnonymous: z.boolean(),
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
});

export type MeResponse = z.infer<typeof MeResponse>;

export const ErrorResponse = z.object({
  error: z.string(),
  requestId: z.string().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponse>;
