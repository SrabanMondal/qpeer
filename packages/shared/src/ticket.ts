import { ed25519 } from "@noble/curves/ed25519.js";
import { z } from "zod";
import { TokenClass, TokenSeries } from "./queue";

/**
 * Signed offline ticket (C3). The server signs a compact ticket with Ed25519
 * (Worker secret `TICKET_SIGNING_KEY`); the app keeps it and shows it as a QR
 * code that works without a network; staff verify it with the public key
 * (`GET /v1/ticket-keys`, cached, plus a copy bundled in the app).
 *
 * Text form (fits a QR code, ~370 characters):
 *
 *   QPT1.<base64url(JSON payload)>.<base64url(64-byte signature)>
 *
 * The signature covers the ASCII bytes of `QPT1.<base64url(JSON payload)>`.
 * The payload is ASCII-only (ids, numbers, letters).
 */

export const TICKET_PREFIX = "QPT1";

/** Until-close tickets (no validity setting) are signed for this long. */
export const TICKET_DEFAULT_LIFETIME_MS = 24 * 3_600_000;

export const TicketPayload = z.object({
  v: z.literal(1),
  /** Queue id. */
  q: z.string(),
  /** Token id. */
  t: z.string(),
  /** Number and series: the label is `tokenLabel(s, n)`. */
  n: z.number().int(),
  s: TokenSeries,
  c: TokenClass,
  /** Session the number belongs to. */
  sid: z.string(),
  /** Issued = the token's join time (so the same token always signs the same). */
  iat: z.number().int(),
  /** Validity end (C4), or join + 24 h for until-close tickets. */
  exp: z.number().int(),
  /** Signing key id. */
  kid: z.string(),
});
export type TicketPayload = z.infer<typeof TicketPayload>;

/** A public Ed25519 key as a JWK (no `d`). */
export const TicketPublicJwk = z.object({
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: z.string(),
  kid: z.string(),
  alg: z.string().optional(),
  use: z.string().optional(),
});
export type TicketPublicJwk = z.infer<typeof TicketPublicJwk>;

/** GET /v1/ticket-keys (public, cacheable). Empty when signing is off. */
export const TicketKeysResponse = z.object({
  keys: z.array(TicketPublicJwk),
});
export type TicketKeysResponse = z.infer<typeof TicketKeysResponse>;

// ---------- base64url (no Buffer/atob: runs in Hermes, Workers and Node) ----------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

/** Null when the text is not base64url. */
export function base64UrlDecode(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, "");
  if (clean.length % 4 === 1) return null;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64_INDEX.get(ch);
    if (v === undefined) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** ASCII text → bytes; throws on non-ASCII (the payload never has any). */
export function asciiBytes(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 127) throw new Error("ticket text must be ASCII");
    out[i] = c;
  }
  return out;
}

function asciiText(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

// ---------- encode / parse ----------

/** The part the signature covers: `QPT1.<base64url(payload)>`. */
export function ticketSigningInput(p: TicketPayload): string {
  return `${TICKET_PREFIX}.${base64UrlEncode(asciiBytes(JSON.stringify(p)))}`;
}

export function encodeTicket(signingInput: string, signature: Uint8Array) {
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export type ParsedTicket = {
  payload: TicketPayload;
  signingInput: string;
  signature: Uint8Array;
};

/** Null when the text is not a well-formed QPeer ticket. */
export function parseTicket(text: string): ParsedTicket | null {
  const parts = text.trim().split(".");
  if (parts.length !== 3 || parts[0] !== TICKET_PREFIX) return null;
  const body = base64UrlDecode(parts[1]);
  const signature = base64UrlDecode(parts[2]);
  if (!body || !signature || signature.length !== 64) return null;
  let json: unknown;
  try {
    json = JSON.parse(asciiText(body));
  } catch {
    return null;
  }
  const payload = TicketPayload.safeParse(json);
  if (!payload.success) return null;
  return {
    payload: payload.data,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature,
  };
}

// ---------- verify (offline) ----------

export type TicketCheck =
  | { status: "malformed" }
  | { status: "unknown_key"; payload: TicketPayload }
  | { status: "bad_signature"; payload: TicketPayload }
  | { status: "expired"; payload: TicketPayload }
  | { status: "other_queue"; payload: TicketPayload }
  | { status: "valid"; payload: TicketPayload };

/**
 * Checks a scanned ticket offline, in this order: format, key (by `kid`),
 * signature, expiry, queue. Only `valid` means "issued by QPeer for this
 * queue and not expired"; the console then cross-checks the live state when
 * online (the ticket may have been served or left since).
 */
export function verifyTicket(
  text: string,
  keys: readonly TicketPublicJwk[],
  opts: { now: number; queueId?: string },
): TicketCheck {
  const t = parseTicket(text);
  if (!t) return { status: "malformed" };
  const key = keys.find((k) => k.kid === t.payload.kid);
  const raw = key ? base64UrlDecode(key.x) : null;
  if (raw?.length !== 32) {
    return { status: "unknown_key", payload: t.payload };
  }
  let ok = false;
  try {
    ok = ed25519.verify(t.signature, asciiBytes(t.signingInput), raw);
  } catch {
    ok = false;
  }
  if (!ok) return { status: "bad_signature", payload: t.payload };
  if (opts.now > t.payload.exp)
    return { status: "expired", payload: t.payload };
  if (opts.queueId && opts.queueId !== t.payload.q) {
    return { status: "other_queue", payload: t.payload };
  }
  return { status: "valid", payload: t.payload };
}

/** Parses a JWK set leniently: keeps the well-formed public keys only. */
export function publicTicketKeys(value: unknown): TicketPublicJwk[] {
  const list =
    typeof value === "object" && value !== null && "keys" in value
      ? (value as { keys: unknown }).keys
      : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap((k) => {
    const r = TicketPublicJwk.safeParse(k);
    return r.success ? [r.data] : [];
  });
}
