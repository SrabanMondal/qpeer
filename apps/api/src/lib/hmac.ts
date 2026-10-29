/**
 * HMAC-SHA256 helpers (Razorpay signatures) via WebCrypto. Signatures and
 * secrets are never logged.
 */

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Lowercase hex HMAC-SHA256 of `message` with `secret`. */
export async function hmacSha256Hex(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Lowercase hex SHA-256. */
export async function sha256Hex(message: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(message)));
}

/** Constant-time comparison of two strings (length leak only). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when `signature` is the hex HMAC-SHA256 of `message` with `secret`. */
export async function verifyHmac(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(secret, message);
  return timingSafeEqual(expected, signature.trim().toLowerCase());
}
