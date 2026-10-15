import type { BusinessRole, ErrorCode } from "@qpeer/shared";
import type { User } from "./db/schema";
import type { Clock } from "./lib/time";
import type { QueueDO } from "./queue-do";

export interface Bindings {
  DB: D1Database;
  QUEUE: DurableObjectNamespace<QueueDO>;
  FIREBASE_PROJECT_ID: string;
  ENVIRONMENT: string;
}

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
    membership?: Membership;
    errorCode?: ErrorCode;
  };
}
