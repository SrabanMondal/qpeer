import type { ValidationIssue } from "@qpeer/shared";
import type { Context } from "hono";
import type { z } from "zod";
import { AppError } from "./errors";

function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
}

export function invalidInput(details: ValidationIssue[]): AppError {
  return new AppError(400, "invalid_input", "Invalid input", details);
}

/** Parse a value with a shared schema or throw 400 `invalid_input` with field details. */
export function parseWith<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw invalidInput(toIssues(result.error));
  return result.data;
}

/** Parse the JSON request body. A missing or malformed body is `invalid_input`. */
export async function parseBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw invalidInput([{ path: "", message: "Body must be valid JSON" }]);
  }
  return parseWith(schema, raw);
}

/** Parse the query string (single values per key). */
export function parseQuery<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): z.output<S> {
  return parseWith(schema, c.req.query());
}
