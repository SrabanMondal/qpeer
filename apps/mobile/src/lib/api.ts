import { ErrorResponse, MeResponse } from "@qpeer/shared";
import { getAuth, getIdToken } from "@react-native-firebase/auth";
import { useQuery } from "@tanstack/react-query";
import type { ZodType, ZodTypeDef } from "zod";

import { config } from "@/config";
import { providerOf, useAuth } from "@/lib/auth";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  401: "You are not signed in, or your session has expired.",
  403: "You are not allowed to do that.",
  404: "Not found.",
  429: "Too many requests. Please wait a moment.",
};

function messageFor(status: number, code: string): string {
  return (
    STATUS_MESSAGES[status] ??
    (status >= 500
      ? "The server had a problem. Please try again."
      : `Request failed (${code}).`)
  );
}

/**
 * Calls the QPeer API with the current user's Firebase ID token and validates
 * the JSON response with a shared zod schema.
 */
export async function apiFetch<T>(
  path: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  init?: RequestInit,
): Promise<T> {
  const user = getAuth().currentUser;
  if (!user) {
    throw new ApiError({
      status: 401,
      code: "no_user",
      message: "Not signed in yet.",
    });
  }
  const token = await getIdToken(user);

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = `${config.apiUrl}${path.startsWith("/") ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new ApiError({
      status: 0,
      code: "network",
      message: "Could not reach the server. Check your internet connection.",
    });
  }

  const headerRequestId = response.headers.get("x-request-id") ?? undefined;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (or empty); handled below.
  }

  if (!response.ok) {
    const parsed = ErrorResponse.safeParse(body);
    const code = parsed.success ? parsed.data.error : `http_${response.status}`;
    throw new ApiError({
      status: response.status,
      code,
      message: messageFor(response.status, code),
      requestId:
        (parsed.success ? parsed.data.requestId : undefined) ?? headerRequestId,
    });
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError({
      status: response.status,
      code: "invalid_response",
      message: "The server sent an unexpected response.",
      requestId: headerRequestId,
    });
  }
  return result.data;
}

/** GET /v1/me for the signed-in Firebase user. */
export function useMe() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  return useQuery({
    // The provider part makes the query refetch after linking Google/phone
    // (linking keeps the uid but changes the providers).
    queryKey: ["me", uid, providerOf(user)],
    queryFn: () => apiFetch("/v1/me", MeResponse),
    enabled: uid !== null,
  });
}
