import type { BusinessRole, ErrorCode } from "@qpeer/shared";
import type { User } from "./db/schema";
import type { Clock } from "./lib/time";
import type { QueueDO } from "./queue/queue-do";

export interface Bindings {
  DB: D1Database;
  QUEUE: DurableObjectNamespace<QueueDO>;
  FIREBASE_PROJECT_ID: string;
  ENVIRONMENT: string;
  /** Optional secret, only if Expo push security is enabled (§17). */
  EXPO_ACCESS_TOKEN?: string;
  /**
   * Public JWK set of the load-test signing key (secret, `loadtest` env only).
   * Ignored unless `ENVIRONMENT` is exactly `loadtest` (see middleware/auth.ts).
   */
  LOADTEST_JWKS?: string;
  /**
   * C3: Ed25519 private JWK (secret) that signs offline tickets. Optional:
   * without it no ticket is signed (local, tests) and nothing breaks.
   */
  TICKET_SIGNING_KEY?: string;
  /** C3: extra public JWK set accepted during a key rotation (var, optional). */
  TICKET_PUBLIC_KEYS?: string;
  /**
   * Step 4 Razorpay (test mode). All three are Worker secrets (`.dev.vars`
   * locally); the key id is returned to the app in order responses, never
   * bundled. Missing → payment routes answer 500 with a clear log line.
   */
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
}

export type AuthSource = "firebase" | "loadtest";

/** Set by `requireBusinessRole` once the caller's membership is confirmed. */
export interface Membership {
  businessId: string;
  role: BusinessRole;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    requestId: string;
    clock: Clock;
    userId?: string;
    user?: User;
    /** Which verifier accepted the caller's token. */
    authSource?: AuthSource;
    membership?: Membership;
    errorCode?: ErrorCode;
  };
}
