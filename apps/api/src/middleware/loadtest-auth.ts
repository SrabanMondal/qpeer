import {
  createLocalJWKSet,
  decodeJwt,
  type JSONWebKeySet,
  jwtVerify,
} from "jose";
import type { TokenVerifier, VerifiedUser } from "./auth";

/**
 * Test-only token verifier for the `loadtest` Worker (Step 3.5). The load-test
 * simulator signs Firebase-shaped tokens with a local RS256 key; the public JWK
 * set is the `LOADTEST_JWKS` secret of the `loadtest` env only.
 *
 * Security: `loadtestEnabled` is the single gate. It requires `ENVIRONMENT` to be
 * exactly "loadtest" AND the secret to be present, so in `local`/`dev`/`demo`
 * (or any unknown environment) this code path is unreachable even if the
 * secret were set there by mistake.
 */
export const LOADTEST_ISSUER = "qpeer-loadtest";
export const LOADTEST_AUDIENCE = "qpeer-loadtest";
export const LOADTEST_ENVIRONMENT = "loadtest";

export function loadtestEnabled(env: {
  ENVIRONMENT?: string;
  LOADTEST_JWKS?: string;
}): env is { ENVIRONMENT: "loadtest"; LOADTEST_JWKS: string } {
  return (
    env.ENVIRONMENT === LOADTEST_ENVIRONMENT &&
    typeof env.LOADTEST_JWKS === "string" &&
    env.LOADTEST_JWKS.trim() !== ""
  );
}

/** True when the (unverified) token claims the load-test issuer. Never throws. */
export function claimsLoadtestIssuer(token: string): boolean {
  try {
    return decodeJwt(token).iss === LOADTEST_ISSUER;
  } catch {
    return false;
  }
}

const verifierCache = new Map<string, TokenVerifier>();

/** Verifier for tokens signed by the load-test key (cached per JWK set). */
export function makeLoadtestVerifier(jwksJson: string): TokenVerifier {
  const cached = verifierCache.get(jwksJson);
  if (cached) return cached;

  const parsed = JSON.parse(jwksJson) as JSONWebKeySet;
  if (!Array.isArray(parsed?.keys) || parsed.keys.length === 0) {
    throw new Error("LOADTEST_JWKS has no keys");
  }
  for (const k of parsed.keys) {
    if ("d" in k) throw new Error("LOADTEST_JWKS must hold public keys only");
  }
  const keys = createLocalJWKSet(parsed);

  const verifier: TokenVerifier = async (token): Promise<VerifiedUser> => {
    const { payload } = await jwtVerify(token, keys, {
      issuer: LOADTEST_ISSUER,
      audience: LOADTEST_AUDIENCE,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub"],
    });
    if (typeof payload.sub !== "string" || payload.sub.trim() === "") {
      throw new Error("Invalid token: sub must be a non-empty string");
    }
    const firebase = payload.firebase as
      | { sign_in_provider?: string }
      | undefined;
    return {
      uid: payload.sub,
      isAnonymous: firebase?.sign_in_provider === "anonymous",
      email: null,
      phone:
        typeof payload.phone_number === "string" ? payload.phone_number : null,
      name: typeof payload.name === "string" ? payload.name : null,
      source: "loadtest",
    };
  };
  verifierCache.set(jwksJson, verifier);
  return verifier;
}
