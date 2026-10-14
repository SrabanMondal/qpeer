import { env } from "cloudflare:workers";
import { MeResponse } from "@qpeer/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { makeFirebaseVerifier } from "../src/auth";
import { users } from "../src/db/schema";

describe("API Skeleton and Auth", () => {
  const testProjectId = "test-firebase-project";
  let privateKey: CryptoKey;
  let keySet: ReturnType<typeof createLocalJWKSet>;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const keyPair = await generateKeyPair("RS256");
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = "test-key-id";
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    keySet = createLocalJWKSet({ keys: [publicJwk] });

    const verifier = makeFirebaseVerifier(testProjectId, keySet);
    app = createApp({ verifier });
  });

  async function createToken(options?: {
    sub?: string;
    aud?: string;
    iss?: string;
    exp?: number;
    auth_time?: number;
    firebase?: { sign_in_provider: string };
    email?: string | null;
    phone_number?: string | null;
    name?: string | null;
    alg?: string;
  }) {
    const now = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
      sub: options?.sub ?? "user-123",
      auth_time: options?.auth_time ?? now - 60,
      firebase: options?.firebase ?? { sign_in_provider: "google.com" },
      email: options?.email !== undefined ? options.email : "user@example.com",
      name: options?.name !== undefined ? options.name : "Test User",
    };

    if (options?.phone_number !== undefined) {
      payload.phone_number = options.phone_number;
    } else {
      payload.phone_number = "+919876543210";
    }

    const alg = options?.alg ?? "RS256";
    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg, kid: "test-key-id" })
      .setIssuer(
        options?.iss ?? `https://securetoken.google.com/${testProjectId}`,
      )
      .setAudience(options?.aud ?? testProjectId)
      .setIssuedAt(now - 60)
      .setExpirationTime(options?.exp ?? now + 3600);

    if (alg === "HS256") {
      const hsSecret = new TextEncoder().encode(
        "symmetric-secret-key-32-chars-long!",
      );
      return jwt.sign(hsSecret);
    }

    return jwt.sign(privateKey);
  }

  it("1. health is public", async () => {
    const res = await app.fetch(new Request("http://localhost/v1/health"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; env: string };
    expect(body.ok).toBe(true);
    expect(body.env).toBe(env.ENVIRONMENT);
    expect(res.headers.get("x-request-id")).toBeDefined();
  });

  it("2. missing header -> 401", async () => {
    const res = await app.fetch(new Request("http://localhost/v1/me"), env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; requestId?: string };
    expect(body.error).toBe("unauthorized");
    expect(body.requestId).toBeDefined();
  });

  it("3. garbage token -> 401", async () => {
    const res = await app.fetch(
      new Request("http://localhost/v1/me", {
        headers: { Authorization: "Bearer this-is-not-a-valid-token" },
      }),
      env,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; requestId?: string };
    expect(body.error).toBe("unauthorized");
    expect(body.requestId).toBeDefined();
  });

  it("4. wrong aud -> 401", async () => {
    const token = await createToken({ aud: "wrong-audience" });
    const res = await app.fetch(
      new Request("http://localhost/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("5. wrong iss -> 401", async () => {
    const token = await createToken({
      iss: "https://securetoken.google.com/wrong-project",
    });
    const res = await app.fetch(
      new Request("http://localhost/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("6. expired -> 401", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createToken({ exp: now - 100 });
    const res = await app.fetch(
      new Request("http://localhost/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("7. HS256-signed token -> 401", async () => {
    const token = await createToken({ alg: "HS256" });
    const res = await app.fetch(
      new Request("http://localhost/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  let validUserId: string;

  it("8. valid token -> 200 with MeResponse-valid body and a users row", async () => {
    const token = await createToken({
      sub: "valid-user-1",
      email: "valid@example.com",
      name: "Valid User",
      phone_number: "+911234567890",
    });

    const res = await app.fetch(
      new Request("http://localhost/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const validated = MeResponse.parse(body);

    expect(validated.user.displayName).toBe("Valid User");
    expect(validated.user.email).toBe("valid@example.com");
    expect(validated.user.phone).toBe("+911234567890");
    expect(validated.user.isAnonymous).toBe(false);
    expect(typeof validated.user.id).toBe("string");

    validUserId = validated.user.id;

    // Verify row in D1
    const db = drizzle(env.DB);
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, "valid-user-1"));

    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(validUserId);
    expect(rows[0].email).toBe("valid@example.com");
    expect(rows[0].displayName).toBe("Valid User");
    expect(rows[0].phone).toBe("+911234567890");
    expect(rows[0].isAnonymous).toBe(false);
  });

  it("9. second call returns the same id (no duplicate row)", async () => {
    const token = await createToken({
      sub: "valid-user-1",
      email: "valid@example.com",
      name: "Valid User",
      phone_number: "+911234567890",
    });

    const res = await app.fetch(
      new Request("http://localhost/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const validated = MeResponse.parse(body);

    expect(validated.user.id).toBe(validUserId);

    // Verify still exactly one row for this uid in D1
    const db = drizzle(env.DB);
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, "valid-user-1"));

    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(validUserId);
  });

  let anonUserId: string;

  it("10. anonymous provider -> isAnonymous: true", async () => {
    const token = await createToken({
      sub: "anon-user-1",
      firebase: { sign_in_provider: "anonymous" },
      email: null,
      name: null,
      phone_number: null,
    });

    const res = await app.fetch(
      new Request("http://localhost/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const validated = MeResponse.parse(body);

    expect(validated.user.isAnonymous).toBe(true);
    expect(validated.user.email).toBeNull();
    expect(validated.user.phone).toBeNull();
    expect(validated.user.displayName).toBeNull();

    anonUserId = validated.user.id;

    const db = drizzle(env.DB);
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, "anon-user-1"));

    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(anonUserId);
    expect(rows[0].isAnonymous).toBe(true);
  });

  it("11. same uid later with Google provider -> same id, isAnonymous updated to false", async () => {
    const upgradedToken = await createToken({
      sub: "anon-user-1",
      firebase: { sign_in_provider: "google.com" },
      email: "upgraded@example.com",
      name: "Upgraded Account",
      phone_number: "+919999988888",
    });

    const res = await app.fetch(
      new Request("http://localhost/v1/me", {
        headers: { Authorization: `Bearer ${upgradedToken}` },
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const validated = MeResponse.parse(body);

    expect(validated.user.id).toBe(anonUserId);
    expect(validated.user.isAnonymous).toBe(false);
    expect(validated.user.email).toBe("upgraded@example.com");
    expect(validated.user.displayName).toBe("Upgraded Account");
    expect(validated.user.phone).toBe("+919999988888");

    // Check D1 database state
    const db = drizzle(env.DB);
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, "anon-user-1"));

    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(anonUserId);
    expect(rows[0].isAnonymous).toBe(false);
    expect(rows[0].email).toBe("upgraded@example.com");
    expect(rows[0].displayName).toBe("Upgraded Account");
  });

  it("12. queue-ping twice on same queue id returns pings 1 then 2, a different id returns 1", async () => {
    const token = await createToken({ sub: "queue-ping-user" });
    const authHeaders = { Authorization: `Bearer ${token}` };

    // First ping on queue-A
    const resA1 = await app.fetch(
      new Request("http://localhost/v1/dev/queue-ping/queue-A", {
        headers: authHeaders,
      }),
      env,
    );
    expect(resA1.status).toBe(200);
    const bodyA1 = (await resA1.json()) as { ok: boolean; pings: number };
    expect(bodyA1.ok).toBe(true);
    expect(bodyA1.pings).toBe(1);

    // Second ping on queue-A
    const resA2 = await app.fetch(
      new Request("http://localhost/v1/dev/queue-ping/queue-A", {
        headers: authHeaders,
      }),
      env,
    );
    expect(resA2.status).toBe(200);
    const bodyA2 = (await resA2.json()) as { ok: boolean; pings: number };
    expect(bodyA2.ok).toBe(true);
    expect(bodyA2.pings).toBe(2);

    // First ping on queue-B
    const resB1 = await app.fetch(
      new Request("http://localhost/v1/dev/queue-ping/queue-B", {
        headers: authHeaders,
      }),
      env,
    );
    expect(resB1.status).toBe(200);
    const bodyB1 = (await resB1.json()) as { ok: boolean; pings: number };
    expect(bodyB1.ok).toBe(true);
    expect(bodyB1.pings).toBe(1);
  });

  it("13. concurrent first requests for a new uid all succeed with one row", async () => {
    const token = await createToken({ sub: "concurrent-user" });
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.fetch(
          new Request("http://localhost/v1/me", {
            headers: { Authorization: `Bearer ${token}` },
          }),
          env,
        ),
      ),
    );

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const ids = await Promise.all(
      responses.map(async (r) => MeResponse.parse(await r.json()).user.id),
    );
    expect(new Set(ids).size).toBe(1);

    const rows = await drizzle(env.DB)
      .select()
      .from(users)
      .where(eq(users.firebaseUid, "concurrent-user"));
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(ids[0]);
  });

  it("14. missing FIREBASE_PROJECT_ID -> 500, not 401", async () => {
    const realApp = createApp();
    const token = await createToken();
    const res = await realApp.fetch(
      new Request("http://localhost/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { ...env, FIREBASE_PROJECT_ID: "" },
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; requestId?: string };
    expect(body.error).toBe("internal");
    expect(body.requestId).toBeDefined();
  });
});
