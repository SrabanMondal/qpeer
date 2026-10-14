import { z } from "zod";

export const DEFAULT_API_URL = "https://qpeer-api-dev.qpeer-api.workers.dev";

// Treat unset and empty values the same way.
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const ConfigSchema = z.object({
  apiUrl: optionalString
    .pipe(z.string().url().optional())
    .transform((value) => (value ?? DEFAULT_API_URL).replace(/\/+$/, "")),
  mapboxToken: optionalString,
  googleWebClientId: optionalString,
});

export type AppConfig = z.infer<typeof ConfigSchema>;

// EXPO_PUBLIC_* variables are inlined at bundle time, so each one must be read
// with a static `process.env.NAME` expression.
export const config: AppConfig = ConfigSchema.parse({
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN,
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});
