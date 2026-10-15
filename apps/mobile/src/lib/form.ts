import type { ValidationIssue } from "@qpeer/shared";
import { useState } from "react";
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

/** True for `path` itself and for paths under it ("mon" covers "mon.0.from"). */
function isUnder(path: string, field: string): boolean {
  return path === field || path.startsWith(`${field}.`);
}

/**
 * B4: field errors that follow the values. Nothing is shown while the user
 * first fills the form; after a submit (or once a field shows an error),
 * every change re-validates that field, so its error clears as soon as the
 * value is valid (and comes back if it becomes invalid again).
 *
 * ```ts
 * const form = useFieldErrors(validate);
 * onChange: (v) => { const next = { ...values, name: v }; setValues(next); form.revalidate(next, "name"); }
 * onSubmit: if (!form.validateAll(values)) return;
 * ```
 */
export function useFieldErrors<V>(validate: (values: V) => FieldErrors) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);

  /** Shows every error; returns true when the values are valid. */
  const validateAll = (values: V): boolean => {
    setSubmitted(true);
    const next = validate(values);
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /** Call after `field` changed; `values` must already contain the change. */
  const revalidate = (values: V, field: string) => {
    const shown = Object.keys(errors).some((p) => isUnder(p, field));
    if (!submitted && !shown) return;
    const fresh = validate(values);
    setErrors((prev) => {
      const next: FieldErrors = {};
      for (const [p, msg] of Object.entries(prev)) {
        if (!isUnder(p, field)) next[p] = msg;
      }
      for (const [p, msg] of Object.entries(fresh)) {
        if (isUnder(p, field)) next[p] = msg;
      }
      return next;
    });
  };

  /** Shows errors from elsewhere (e.g. the API's `invalid_input`). */
  const showErrors = (next: FieldErrors) => {
    setSubmitted(true);
    setErrors(next);
  };

  /** Back to a fresh form: no errors, no live re-validation yet. */
  const reset = () => {
    setSubmitted(false);
    setErrors({});
  };

  return { errors, validateAll, revalidate, showErrors, reset };
}
