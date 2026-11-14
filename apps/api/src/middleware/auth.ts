import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "../db/client";
import type { AppEnv, AuthSource, Bindings } from "../env";
import { AppError } from "../lib/errors";
import { upsertUser } from "../modules/identity/service";
import { claimsDemoIssuer, demoEnabled, makeDemoVerifier } from "./demo-auth";
import {
  claimsLoadtestIssuer,
  loadtestEnabled,
  makeLoadtestVerifier,
} from "./loadtest-auth";

export interface VerifiedUser {
  uid: string;
  isAnonymous: boolean;
  email: string | null;
  phone: string | null;
  name: string | null;
  /** Which verifier accepted the token (default: Firebase). */
  source?: AuthSource;
}

export type TokenVerifier = (token: string) => Promise<VerifiedUser>;

export type KeySource = Parameters<typeof jwtVerify>[1];

const GOOGLE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const productionKeySet = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export function makeFirebaseVerifier(
  projectId: string,
  keySource?: KeySource,
): TokenVerifier {
  const keys = keySource ?? productionKeySet;
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const expectedAudience = projectId;

  return async (token: string): Promise<VerifiedUser> => {
    const { payload } = await jwtVerify(token, keys, {
      issuer: expectedIssuer,
      audience: expectedAudience,
      algorithms: ["RS256"],
    });

    if (
      !payload.sub ||
      typeof payload.sub !== "string" ||
      payload.sub.trim() === ""
    ) {
      throw new Error("Invalid token: sub must be a non-empty string");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      typeof payload.auth_time === "number" &&
      payload.auth_time > nowSeconds
    ) {
      throw new Error("Invalid token: auth_time is in the future");
    }

    const firebase = payload.firebase as
      | { sign_in_provider?: string }
      | undefined;
    const isAnonymous = firebase?.sign_in_provider === "anonymous";

    const email = typeof payload.email === "string" ? payload.email : null;
    const phone =
      typeof payload.phone_number === "string"
        ? payload.phone_number
        : typeof payload.phone === "string"
          ? payload.phone
          : null;
    const name = typeof payload.name === "string" ? payload.name : null;

    return {
      uid: payload.sub,
      isAnonymous,
      email,
      phone,
      name,
    };
  };
}

const unauthorized = () =>
  new AppError(401, "unauthorized", "Missing or invalid token");

/**
 * The verifier for this environment: Firebase everywhere; in the `loadtest`
 * env only (with the `LOADTEST_JWKS` secret), tokens whose issuer is
 * `qpeer-loadtest` go to the load-test verifier instead; in `demo`/`dev`/
 * `local` (with the `DEMO_JWKS` secret), tokens whose issuer is `qpeer-demo`
 * go to the demo verifier (Step 5). Everywhere else such a token reaches the
 * Firebase verifier and fails its issuer check (401).
 */
export function verifierForEnv(
  env: Pick<
    Bindings,
    "FIREBASE_PROJECT_ID" | "ENVIRONMENT" | "LOADTEST_JWKS" | "DEMO_JWKS"
  >,
  firebaseKeys?: KeySource,
): TokenVerifier {
  if (!env.FIREBASE_PROJECT_ID?.trim()) {
    throw new Error("FIREBASE_PROJECT_ID is not configured");
  }
  const firebase = makeFirebaseVerifier(env.FIREBASE_PROJECT_ID, firebaseKeys);
  const loadtest = loadtestEnabled(env)
    ? makeLoadtestVerifier(env.LOADTEST_JWKS)
    : null;
  const demo = demoEnabled(env) ? makeDemoVerifier(env.DEMO_JWKS) : null;
  if (!loadtest && !demo) return firebase;
  return (token) => {
    if (loadtest && claimsLoadtestIssuer(token)) return loadtest(token);
    if (demo && claimsDemoIssuer(token)) return demo(token);
    return firebase(token);
  };
}

export interface AuthOptions {
  /** Replaces verification entirely (tests use a local RS256 key). */
  verifier?: TokenVerifier;
  /** Firebase key source for the env-selected verifier (tests only). */
  firebaseKeys?: KeySource;
}

/**
 * Verifies the ID token and loads (or creates) the user into `c.var.user`.
 * Only verification failures are 401; config and database errors become 500.
 */
export function authMiddleware(opts: AuthOptions = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw unauthorized();

    const token = authHeader.slice(7).trim();
    if (!token) throw unauthorized();

    const verifier = opts.verifier ?? verifierForEnv(c.env, opts.firebaseKeys);

    let verified: VerifiedUser;
    try {
      verified = await verifier(token);
    } catch {
      // Never log the token.
      throw unauthorized();
    }

    const user = await upsertUser(db(c.env.DB), c.get("clock").now(), verified);
    c.set("userId", user.id);
    c.set("user", user);
    c.set("authSource", verified.source ?? "firebase");
    await next();
  });
}
