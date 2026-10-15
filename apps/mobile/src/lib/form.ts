import type { ValidationIssue } from "@qpeer/shared";
import type { ZodError } from "zod";

/** Field path ("hours.mon.0.to") → first message for that path. */
export type FieldErrors = Record<string, string>;

export function zodFieldErrors(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!(path in out)) out[path] = issue.message;
  }
  return out;
}

/** Same shape from the API's `invalid_input` details. */
export function apiFieldErrors(
  issues: readonly ValidationIssue[],
): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    if (!(issue.path in out)) out[issue.path] = issue.message;
  }
  return out;
}
