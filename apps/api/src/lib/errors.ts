import type { ErrorCode, ErrorResponse } from "@qpeer/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../env";

export type { ErrorCode };

/** Thrown by services, guards and validators; `onError` turns it into a response. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = "AppError";
    this.publicMessage = message;
  }

  /** Short English fallback sent to clients; only set when given explicitly. */
  readonly publicMessage: string | undefined;
}

export const notFound = () => new AppError(404, "not_found", "Not found");

export function errorBody(
  c: Context<AppEnv>,
  code: ErrorCode,
  message?: string,
  details?: unknown,
): ErrorResponse {
  const body: ErrorResponse = { error: code, requestId: c.get("requestId") };
  if (message !== undefined) body.message = message;
  if (details !== undefined) body.details = details;
  return body;
}

/** Maps AppError to its status/code; anything else is a 500 that never leaks its message. */
export function onError(err: Error, c: Context<AppEnv>) {
  if (err instanceof AppError) {
    c.set("errorCode", err.code);
    return c.json(
      errorBody(c, err.code, err.publicMessage, err.details),
      err.status,
    );
  }
  c.set("errorCode", "internal");
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      requestId: c.get("requestId"),
      message: err.message,
    }),
  );
  return c.json(errorBody(c, "internal"), 500);
}
