import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import {
  asciiBytes,
  base64UrlDecode,
  base64UrlEncode,
  encodeTicket,
  parseTicket,
  publicTicketKeys,
  type TicketPayload,
  type TicketPublicJwk,
  ticketSigningInput,
  verifyTicket,
} from "./ticket";

/** Throwaway key for tests only (never a real signing key). */
function testKey(kid: string) {
  const secret = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(secret);
  const jwk: TicketPublicJwk = {
    kty: "OKP",
    crv: "Ed25519",
    x: base64UrlEncode(pub),
    kid,
  };
  return { secret, jwk };
}

const payload: TicketPayload = {
  v: 1,
  q: "11111111-1111-4111-8111-111111111111",
  t: "22222222-2222-4222-8222-222222222222",
  n: 12,
  s: "R",
  c: "regular",
  sid: "33333333-3333-4333-8333-333333333333",
  iat: 1_800_000_000_000,
  exp: 1_800_086_400_000,
  kid: "k1",
};

function sign(p: TicketPayload, secret: Uint8Array) {
  const input = ticketSigningInput(p);
  return encodeTicket(input, ed25519.sign(asciiBytes(input), secret));
}

describe("base64url", () => {
  it("round-trips every length", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) % 256);
      const text = base64UrlEncode(bytes);
      expect(text).not.toMatch(/[+/=]/);
      expect(base64UrlDecode(text)).toEqual(bytes);
    }
  });
  it("rejects other characters", () => {
    expect(base64UrlDecode("ab+c")).toBeNull();
  });
});

describe("signed ticket (C3)", () => {
  const { secret, jwk } = testKey("k1");

  it("parses back to the same payload and stays QR-sized", () => {
    const text = sign(payload, secret);
    expect(text.startsWith("QPT1.")).toBe(true);
    expect(text.length).toBeLessThan(450);
    expect(parseTicket(text)?.payload).toEqual(payload);
  });

  it("valid for the right queue before it expires", () => {
    const r = verifyTicket(sign(payload, secret), [jwk], {
      now: payload.iat + 1000,
      queueId: payload.q,
    });
    expect(r.status).toBe("valid");
  });

  it("expired after exp", () => {
    const r = verifyTicket(sign(payload, secret), [jwk], {
      now: payload.exp + 1,
    });
    expect(r.status).toBe("expired");
  });

  it("other queue", () => {
    const r = verifyTicket(sign(payload, secret), [jwk], {
      now: payload.iat,
      queueId: "another",
    });
    expect(r.status).toBe("other_queue");
  });

  it("a changed number breaks the signature", () => {
    const text = sign(payload, secret);
    const forged = encodeTicket(
      ticketSigningInput({ ...payload, n: 1 }),
      base64UrlDecode(text.split(".")[2]) ?? new Uint8Array(),
    );
    expect(verifyTicket(forged, [jwk], { now: payload.iat }).status).toBe(
      "bad_signature",
    );
  });

  it("another key's signature or an unknown kid fails", () => {
    const other = testKey("k1");
    expect(
      verifyTicket(sign(payload, other.secret), [jwk], { now: payload.iat })
        .status,
    ).toBe("bad_signature");
    expect(
      verifyTicket(sign({ ...payload, kid: "k9" }, secret), [jwk], {
        now: payload.iat,
      }).status,
    ).toBe("unknown_key");
  });

  it("malformed text", () => {
    for (const bad of ["", "qpeer://q/x", "QPT1.a.b", "QPT1..", "X.Y.Z"]) {
      expect(verifyTicket(bad, [jwk], { now: 0 }).status).toBe("malformed");
    }
  });

  it("publicTicketKeys keeps public parts only", () => {
    const keys = publicTicketKeys({
      keys: [{ ...jwk, d: "secret" }, { kty: "RSA" }],
    });
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toHaveProperty("d");
    expect(publicTicketKeys("nonsense")).toEqual([]);
  });
});
