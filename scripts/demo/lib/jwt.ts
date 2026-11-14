import { createPrivateKey, type KeyObject, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { DEMO_PRIVATE_KEY_PATH } from "./target.ts";

/** Must match apps/api/src/middleware/demo-auth.ts. */
const ISSUER = "qpeer-demo";
const AUDIENCE = "qpeer-demo";
const TOKEN_TTL_S = 3 * 3600;

export interface Signer {
  /**
   * Firebase-shaped token for a simulated user. The server turns `sub` into
   * the uid `demo:<sub>`, so it can never be a real person.
   */
  token(sub: string, opts?: { registered?: boolean }): string;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Loads the private JWK (never logged) and signs RS256 tokens with node:crypto. */
export function loadSigner(path = DEMO_PRIVATE_KEY_PATH): Signer {
  let jwk: { kid?: string } & Record<string, unknown>;
  try {
    jwk = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      `Cannot read the demo key at ${path}. Run 'npm run demo:gen-key' first.`,
    );
  }
  const key: KeyObject = createPrivateKey({
    key: jwk,
    format: "jwk",
  } as Parameters<typeof createPrivateKey>[0]);
  const kid = jwk.kid ?? "demo";
  const cache = new Map<string, string>();

  return {
    token(sub, opts = {}) {
      const cacheKey = `${sub}|${opts.registered ? 1 : 0}`;
      const hit = cache.get(cacheKey);
      if (hit) return hit;
      const now = Math.floor(Date.now() / 1000);
      const header = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
      const payload = b64url(
        JSON.stringify({
          iss: ISSUER,
          aud: AUDIENCE,
          sub,
          iat: now - 30,
          exp: now + TOKEN_TTL_S,
          firebase: {
            sign_in_provider: opts.registered ? "phone" : "anonymous",
          },
          ...(opts.registered ? { name: "Demo owner" } : {}),
        }),
      );
      const input = `${header}.${payload}`;
      const sig = sign("sha256", Buffer.from(input), key);
      const tok = `${input}.${b64url(sig)}`;
      cache.set(cacheKey, tok);
      return tok;
    },
  };
}

/** The demo owner: owns every seeded business, runs the consoles. */
export const OWNER_SUB = "owner";
