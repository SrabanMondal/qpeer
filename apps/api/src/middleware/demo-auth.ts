import type { TokenVerifier } from "./auth";
import { claimsIssuer, makeSignedKeyVerifier } from "./loadtest-auth";

/**
 * Demo simulator auth (Step 5, DEM-04). The `scripts/demo` tools sign
 * Firebase-shaped RS256 tokens with a local key; its public JWK set is the
 * `DEMO_JWKS` secret.
 *
 * Isolation (same idea as `LOADTEST_JWKS`, architecture §19.1):
 * - `demoEnabled` is the single gate: `ENVIRONMENT` must be exactly `demo`,
 *   `dev` or `local` (wrangler dev, tests) AND the secret present. In
 *   `loadtest` or any other environment a demo token reaches the Firebase
 *   verifier and fails (401), even if the secret were set by mistake.
 * - Verified uids are `demo:<sub>`. Firebase uids never contain `:`, so a
 *   demo token can never act as a real person, and every simulated user is
 *   findable (and deletable) by that prefix.
 * - Simulated users register no push devices, so they never get real pushes.
 */
export const DEMO_ISSUER = "qpeer-demo";
export const DEMO_AUDIENCE = "qpeer-demo";
export const DEMO_UID_PREFIX = "demo:";
export const DEMO_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "local",
  "dev",
  "demo",
]);

export function demoEnabled(env: {
  ENVIRONMENT?: string;
  DEMO_JWKS?: string;
}): env is { ENVIRONMENT: string; DEMO_JWKS: string } {
  return (
    typeof env.ENVIRONMENT === "string" &&
    DEMO_ENVIRONMENTS.has(env.ENVIRONMENT) &&
    typeof env.DEMO_JWKS === "string" &&
    env.DEMO_JWKS.trim() !== ""
  );
}

export const claimsDemoIssuer = (token: string) =>
  claimsIssuer(token, DEMO_ISSUER);

export function makeDemoVerifier(jwksJson: string): TokenVerifier {
  return makeSignedKeyVerifier(jwksJson, {
    issuer: DEMO_ISSUER,
    audience: DEMO_AUDIENCE,
    source: "demo",
    secretName: "DEMO_JWKS",
    uidPrefix: DEMO_UID_PREFIX,
  });
}
