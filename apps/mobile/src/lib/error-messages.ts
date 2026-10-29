import type { ErrorCode } from "@qpeer/shared";

/**
 * Friendly English text for every API error code (architecture doc section 7),
 * plus the codes the app itself produces. The API only sends a code and a short
 * fallback; what the user reads is decided here, in one place.
 */
const API_MESSAGES: Record<ErrorCode, string> = {
  invalid_input: "Some details are not valid. Check the form and try again.",
  unauthorized: "Your session has expired. Close and reopen the app.",
  forbidden: "You are not allowed to do that.",
  registration_required: "Sign in with phone or Google to do this.",
  not_found: "We could not find that. It may have been removed.",
  conflict: "Something changed at the same time. Refresh and try again.",
  already_in_queue: "You are already in this queue.",
  device_in_queue:
    "This phone already has a ticket in this queue, from another account.",
  queue_closed: "This queue is closed right now.",
  queue_paused: "This queue is paused right now.",
  queue_full: "This queue is full.",
  quota_full: "No more reservations are available for this hour.",
  priority_off: "Priority Pass is not offered at this queue.",
  sold_out: "Priority Passes are sold out for today.",
  pass_limit: "You already bought a Priority Pass for this queue today.",
  invalid_state: "That is not possible right now.",
  too_far: "You are too far from the business to join as a walk-in.",
  mock_location: "Turn off mock location to join.",
  no_location_fix: "We could not get your location. Try again outdoors.",
  free_lane_blocked:
    "You missed several turns recently, so walk-in joins are paused for a while.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  payment_provider_error: "The payment service had a problem. Try again.",
  internal: "The server had a problem. Try again.",
};

/** Codes created by the app (see `apiFetch`). */
const CLIENT_MESSAGES: Record<string, string> = {
  network: "Could not reach the server. Check your internet connection.",
  no_user: "Still connecting. Try again in a moment.",
  invalid_response: "The server sent an unexpected response. Try again.",
};

export function messageForCode(code: string, status?: number): string {
  if (code in API_MESSAGES) return API_MESSAGES[code as ErrorCode];
  const client = CLIENT_MESSAGES[code];
  if (client) return client;
  if (status !== undefined && status >= 500) return API_MESSAGES.internal;
  return "Something went wrong. Try again.";
}

/** The user-facing message of any thrown value (ApiError messages come from the map above). */
export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}
