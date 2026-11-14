import { z } from "zod";

/**
 * Demo tool routes (Step 5, DEM-01…06). Reachable only with a demo-key token
 * on `demo` / `dev` / `local` (architecture doc §19.2); every other caller
 * gets 404. Used by `scripts/demo` (seed, simulate, reset).
 */

/** Weeks of synthetic history the seed may write (DEM-02: 4–8). */
export const DEMO_MIN_WEEKS = 4;
export const DEMO_MAX_WEEKS = 8;

/**
 * POST /v1/demo/seed: one business of the catalogue (1-based index) with its
 * queues, pin, hours and owners. One request per business keeps every request
 * inside the free plan's per-request D1 query limit; idempotent.
 */
export const DemoSeedBody = z
  .object({
    businessIndex: z.number().int().min(1).max(50),
    /**
     * Phone numbers (E.164) of accounts that signed in on this environment
     * once; they become owners of every demo business (to show Insights on a
     * phone). Unknown numbers are reported, not created.
     */
    ownerPhones: z
      .array(
        z.string().regex(/^\+[1-9]\d{6,14}$/, "Expected +<country><number>"),
      )
      .max(5)
      .default([]),
  })
  .strict();
export type DemoSeedBody = z.infer<typeof DemoSeedBody>;

export const DemoQueue = z.object({
  id: z.string(),
  name: z.string(),
  businessId: z.string(),
  businessName: z.string(),
  /** 1-based index of the business in the demo catalogue. */
  businessIndex: z.number().int(),
  /** The business pin (a made-up demo location, not a person's). */
  lat: z.number(),
  lng: z.number(),
  priorityEnabled: z.boolean(),
});
export type DemoQueue = z.infer<typeof DemoQueue>;

export const DemoSeedResponse = z.object({
  /** How many businesses the catalogue has (the script seeds 1…n). */
  catalogSize: z.number().int(),
  businessId: z.string(),
  businessName: z.string(),
  /** False when the business already existed (nothing changed). */
  created: z.boolean(),
  queues: z.array(DemoQueue),
  ownersAdded: z.array(z.string()),
  ownersMissing: z.array(z.string()),
});
export type DemoSeedResponse = z.infer<typeof DemoSeedResponse>;

/** GET /v1/demo/queues: the seeded queues (the simulator's targets). */
export const DemoQueuesResponse = z.object({ queues: z.array(DemoQueue) });
export type DemoQueuesResponse = z.infer<typeof DemoQueuesResponse>;

/** POST /v1/demo/seed/history: one business's history (one request each, to stay inside per-request limits). */
export const DemoHistoryBody = z
  .object({
    businessIndex: z.number().int().min(1).max(50),
    weeks: z.number().int().min(DEMO_MIN_WEEKS).max(DEMO_MAX_WEEKS).default(6),
    seed: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,40}$/)
      .default("qpeer-demo"),
  })
  .strict();
export type DemoHistoryBody = z.infer<typeof DemoHistoryBody>;

export const DemoHistoryResponse = z.object({
  businessId: z.string(),
  analyticsRows: z.number().int(),
  payments: z.number().int(),
  ledgerRows: z.number().int(),
});
export type DemoHistoryResponse = z.infer<typeof DemoHistoryResponse>;

/**
 * POST /v1/demo/reset. Default: only demo rows (seeded businesses and their
 * queues, tokens, analytics, payments, ledger; simulated `demo:` users).
 * `wipeAll` (ENVIRONMENT=demo or local only) also empties every business,
 * ticket and payment table; user accounts stay so phones stay signed in.
 */
export const DemoResetBody = z
  .object({ wipeAll: z.boolean().default(false) })
  .strict();
export type DemoResetBody = z.infer<typeof DemoResetBody>;

/** 200 when done; 409 with `done: false` while queue outboxes still drain (retry). */
export const DemoResetResponse = z.object({
  done: z.boolean(),
  closedQueues: z.number().int(),
  pendingOutbox: z.number().int(),
  deleted: z.record(z.string(), z.number().int()),
});
export type DemoResetResponse = z.infer<typeof DemoResetResponse>;
