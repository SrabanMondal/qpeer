import { ErrorResponse, ValidationIssue } from "@qpeer/shared";
import { getAuth, getIdToken } from "@react-native-firebase/auth";
import type { ZodType, ZodTypeDef } from "zod";

import { config } from "@/config";
import { messageForCode } from "@/lib/error-messages";

export class ApiError extends Error {
  readonly status: number;
  /** An `ErrorCode` from the API, or an app code: `network`, `no_user`, `invalid_response`, `http_<status>`. */
  readonly code: string;
  readonly requestId: string | undefined;
  /** Field problems for `invalid_input`. */
  readonly issues: ValidationIssue[];

  constructor(opts: {
    status: number;
    code: string;
    message?: string;
    requestId?: string;
    issues?: ValidationIssue[];
  }) {
    super(opts.message ?? messageForCode(opts.code, opts.status));
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
    this.issues = opts.issues ?? [];
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * Calls the QPeer API with the current user's Firebase ID token and validates
 * the JSON response with a shared zod schema. `body` is sent as JSON.
 */
export async function apiFetch<T>(
  path: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  init?: { method?: Method; body?: unknown },
): Promise<T> {
  const user = getAuth().currentUser;
  if (!user) throw new ApiError({ status: 401, code: "no_user" });
  const token = await getIdToken(user);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  let body: string | undefined;
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  const url = `${config.apiUrl}${path.startsWith("/") ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: init?.method ?? "GET",
      headers,
      body,
    });
  } catch {
    throw new ApiError({ status: 0, code: "network" });
  }

  const headerRequestId = response.headers.get("x-request-id") ?? undefined;
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Not JSON (or empty); handled below.
  }

  if (!response.ok) {
    const parsed = ErrorResponse.safeParse(json);
    const code = parsed.success ? parsed.data.error : `http_${response.status}`;
    const issues = parsed.success
      ? ValidationIssue.array().safeParse(parsed.data.details)
      : undefined;
    throw new ApiError({
      status: response.status,
      code,
      requestId:
        (parsed.success ? parsed.data.requestId : undefined) ?? headerRequestId,
      issues: issues?.success ? issues.data : undefined,
    });
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiError({
      status: response.status,
      code: "invalid_response",
      requestId: headerRequestId,
    });
  }
  return result.data;
}
