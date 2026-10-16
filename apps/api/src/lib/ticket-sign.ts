import {
  asciiBytes,
  encodeTicket,
  isActiveState,
  publicTicketKeys,
  TICKET_DEFAULT_LIFETIME_MS,
  type TicketPayload,
  type TicketPublicJwk,
  type TokenView,
  ticketSigningInput,
} from "@qpeer/shared";

/**
 * C3: signs compact offline tickets with Ed25519 (Workers WebCrypto). The
 * private key is the `TICKET_SIGNING_KEY` secret: an OKP/Ed25519 private JWK
 * with `kid` (made by `scripts/ticket-keys/gen-key.ts`). Without the secret
 * (local, tests that don't set one) nothing is signed: tickets are null and
 * `GET /v1/ticket-keys` is empty. A broken secret is logged once per isolate
 * and also disables signing (a join never fails because of the ticket).
 */

export interface TicketEnv {
  TICKET_SIGNING_KEY?: string;
  /** Optional extra public keys (JSON JWK set) still accepted during a rotation. */
  TICKET_PUBLIC_KEYS?: string;
}

interface Signer {
  kid: string;
  key: CryptoKey;
  publicJwk: TicketPublicJwk;
}

let cached: { secret: string; signer: Promise<Signer | null> } | null = null;

function logError(message: string) {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      where: "ticket-sign",
      message,
    }),
  );
}

async function loadSigner(secret: string): Promise<Signer | null> {
  try {
    const jwk = JSON.parse(secret) as JsonWebKey & { kid?: string };
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d || !jwk.x) {
      logError("TICKET_SIGNING_KEY is not an Ed25519 private JWK");
      return null;
    }
    if (!jwk.kid) {
      logError("TICKET_SIGNING_KEY has no kid");
      return null;
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", d: jwk.d, x: jwk.x },
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    return {
      kid: jwk.kid,
      key,
      publicJwk: {
        kty: "OKP",
        crv: "Ed25519",
        x: jwk.x,
        kid: jwk.kid,
        alg: "EdDSA",
        use: "sig",
      },
    };
  } catch (e) {
    // Never log the secret itself, only that it could not be used.
    logError(
      `TICKET_SIGNING_KEY could not be loaded: ${e instanceof Error ? e.name : "error"}`,
    );
    return null;
  }
}

function signer(env: TicketEnv): Promise<Signer | null> {
  const secret = env.TICKET_SIGNING_KEY;
  if (!secret) return Promise.resolve(null);
  if (cached?.secret !== secret) {
    cached = { secret, signer: loadSigner(secret) };
  }
  return cached.signer;
}

/** The payload for a token view (`iat` = join time, so it is deterministic). */
export function ticketPayload(t: TokenView, kid: string): TicketPayload | null {
  if (!t.sessionId || !t.cls) return null;
  return {
    v: 1,
    q: t.queueId,
    t: t.id,
    n: t.number,
    s: t.series,
    c: t.cls,
    sid: t.sessionId,
    iat: t.joinedAt,
    exp: t.expiresAt ?? t.joinedAt + TICKET_DEFAULT_LIFETIME_MS,
    kid,
  };
}

/** Signed ticket text for an active token, or null (no key / ended token). */
export async function signTicket(
  env: TicketEnv,
  t: TokenView,
): Promise<string | null> {
  if (!isActiveState(t.state)) return null;
  const s = await signer(env);
  if (!s) return null;
  const payload = ticketPayload(t, s.kid);
  if (!payload) return null;
  const input = ticketSigningInput(payload);
  const sig = await crypto.subtle.sign("Ed25519", s.key, asciiBytes(input));
  return encodeTicket(input, new Uint8Array(sig));
}

/** The view with `signedTicket` set (null when nothing could be signed). */
export async function withTicket(
  env: TicketEnv,
  t: TokenView,
): Promise<TokenView> {
  return { ...t, signedTicket: await signTicket(env, t) };
}

/** Public keys for `GET /v1/ticket-keys`: the signing key plus rotation extras. */
export async function ticketPublicKeys(
  env: TicketEnv,
): Promise<TicketPublicJwk[]> {
  const keys: TicketPublicJwk[] = [];
  const s = await signer(env);
  if (s) keys.push(s.publicJwk);
  if (env.TICKET_PUBLIC_KEYS) {
    try {
      for (const k of publicTicketKeys(JSON.parse(env.TICKET_PUBLIC_KEYS))) {
        if (!keys.some((x) => x.kid === k.kid)) keys.push(k);
      }
    } catch {
      logError("TICKET_PUBLIC_KEYS is not valid JSON");
    }
  }
  return keys;
}
