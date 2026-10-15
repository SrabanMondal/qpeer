import { env } from "cloudflare:workers";
import { type ErrorCode, ErrorResponse } from "@qpeer/shared";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect } from "vitest";
import type { z } from "zod";
import { createApp } from "../src/app";
import { makeFirebaseVerifier } from "../src/middleware/auth";

export const TEST_PROJECT_ID = "test-firebase-project";

/** A clock tests can move: `clock.t += 1000`. */
export class TestClock {
  constructor(public t = Date.UTC(2026, 9, 15, 4, 30)) {}
  now() {
    return this.t;
  }
}

export interface TokenOptions {
  sub: string;
  anonymous?: boolean;
  name?: string | null;
  email?: string | null;
}

/** App wired to a local RS256 key and a controllable clock, plus request helpers. */
export async function makeTestApi() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: "test-key-id", alg: "RS256", use: "sig" });
  const verifier = makeFirebaseVerifier(
    TEST_PROJECT_ID,
    createLocalJWKSet({ keys: [jwk] }),
  );
  const clock = new TestClock();
  const app = createApp({ verifier, clock });

  async function token(o: TokenOptions): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      auth_time: now - 60,
      firebase: { sign_in_provider: o.anonymous ? "anonymous" : "google.com" },
      email: o.anonymous ? null : (o.email ?? `${o.sub}@example.com`),
      name: o.anonymous ? null : o.name === undefined ? o.sub : o.name,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-id" })
      .setSubject(o.sub)
      .setIssuer(`https://securetoken.google.com/${TEST_PROJECT_ID}`)
      .setAudience(TEST_PROJECT_ID)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 3600)
      .sign(privateKey);
  }

  async function call(
    method: string,
    path: string,
    tok: string | null,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (tok) headers.Authorization = `Bearer ${tok}`;
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }
    return app.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: payload,
      }),
      env,
    );
  }

  return { app, clock, token, call };
}

/** Asserts status and parses the body with its shared schema (contract check). */
export async function expectOk<S extends z.ZodTypeAny>(
  res: Response,
  status: number,
  schema: S,
): Promise<z.output<S>> {
  const raw = await res.text();
  expect(res.status, raw).toBe(status);
  return schema.parse(JSON.parse(raw));
}

/** Asserts an error status/code; the body must parse with `ErrorResponse` and carry the request id. */
export async function expectError(
  res: Response,
  status: number,
  code: ErrorCode,
): Promise<ErrorResponse> {
  const raw = await res.text();
  expect(res.status, raw).toBe(status);
  const body = ErrorResponse.parse(JSON.parse(raw));
  expect(body.error).toBe(code);
  expect(body.requestId).toBeTruthy();
  expect(body.requestId).toBe(res.headers.get("x-request-id"));
  return body;
}
