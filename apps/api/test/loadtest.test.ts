import { env } from "cloudflare:workers";
import { MeResponse } from "@qpeer/shared";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { Bindings } from "../src/env";
import { verifierForEnv } from "../src/middleware/auth";
import {
  LOADTEST_AUDIENCE,
  LOADTEST_ISSUER,
  loadtestEnabled,
} from "../src/middleware/loadtest-auth";
import { RESET_TABLES } from "../src/modules/loadtest/service";
import {
  LOADTEST_TICKET_PREFIX,
  pushTransport,
} from "../src/modules/notifications/expo-push";
import { TEST_PROJECT_ID } from "./helpers";
import { addDevice, must, seedQueue } from "./queue-helpers";

/**
 * Step 3.5: the test-only verifier, the recording push sender and the
 * loadtest helper routes must be unreachable outside ENVIRONMENT=loadtest.
 */

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

let loadtestKey: KeyPair;
let loadtestJwks: string;
let otherKey: KeyPair;
let firebaseKey: KeyPair;
let firebaseJwk: JWK;

beforeAll(async () => {
  loadtestKey = await generateKeyPair("RS256", { extractable: true });
  const pub = await exportJWK(loadtestKey.publicKey);
  loadtestJwks = JSON.stringify({
    keys: [{ ...pub, kid: "lt-1", alg: "RS256", use: "sig" }],
  });
  otherKey = await generateKeyPair("RS256");
  firebaseKey = await generateKeyPair("RS256");
  firebaseJwk = {
    ...(await exportJWK(firebaseKey.publicKey)),
    kid: "fb-1",
    alg: "RS256",
    use: "sig",
  };
});

interface LtTokenOpts {
  sub: string;
  provider?: string;
  iss?: string;
  aud?: string;
  key?: KeyPair;
  expSecondsFromNow?: number;
  phone?: string;
}

async function loadtestToken(o: LtTokenOpts): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    firebase: { sign_in_provider: o.provider ?? "anonymous" },
    ...(o.phone ? { phone_number: o.phone } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "lt-1" })
    .setSubject(o.sub)
    .setIssuer(o.iss ?? LOADTEST_ISSUER)
    .setAudience(o.aud ?? LOADTEST_AUDIENCE)
    .setIssuedAt(now - 10)
    .setExpirationTime(now + (o.expSecondsFromNow ?? 3600))
    .sign((o.key ?? loadtestKey).privateKey);
}

async function firebaseToken(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    auth_time: now - 60,
    firebase: { sign_in_provider: "google.com" },
  })
    .setProtectedHeader({ alg: "RS256", kid: "fb-1" })
    .setSubject(sub)
    .setIssuer(`https://securetoken.google.com/${TEST_PROJECT_ID}`)
    .setAudience(TEST_PROJECT_ID)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 3600)
    .sign(firebaseKey.privateKey);
}

/** App with the real (environment-selected) verifier; Firebase keys are local. */
function realAuthApp() {
  return createApp({
    firebaseKeys: createLocalJWKSet({ keys: [firebaseJwk] }),
  });
}

function envFor(environment: string, extra: Partial<Bindings> = {}) {
  return {
    ...env,
    FIREBASE_PROJECT_ID: TEST_PROJECT_ID,
    ENVIRONMENT: environment,
    LOADTEST_JWKS: loadtestJwks,
    ...extra,
  };
}

async function call(
  environment: string,
  method: string,
  path: string,
  token: string | null,
  extra: Partial<Bindings> = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return realAuthApp().fetch(
    new Request(`http://localhost${path}`, { method, headers }),
    envFor(environment, extra),
  );
}

describe("Loadtest auth isolation (Step 3.5)", () => {
  it.each(["local", "dev", "demo", "", "LOADTEST", "loadtest ", "production"])(
    "a loadtest-signed token is 401 when ENVIRONMENT=%j (secret set anyway)",
    async (environment) => {
      const tok = await loadtestToken({ sub: `lt-iso-${environment}` });
      const res = await call(environment, "GET", "/v1/me", tok);
      expect(res.status).toBe(401);
    },
  );

  it("loadtestEnabled needs exactly ENVIRONMENT=loadtest and a non-empty secret", () => {
    expect(
      loadtestEnabled({ ENVIRONMENT: "loadtest", LOADTEST_JWKS: "{}" }),
    ).toBe(true);
    expect(loadtestEnabled({ ENVIRONMENT: "loadtest" })).toBe(false);
    expect(
      loadtestEnabled({ ENVIRONMENT: "loadtest", LOADTEST_JWKS: "  " }),
    ).toBe(false);
    for (const e of ["local", "dev", "demo", "Loadtest"]) {
      expect(loadtestEnabled({ ENVIRONMENT: e, LOADTEST_JWKS: "{}" })).toBe(
        false,
      );
    }
  });

  it("a loadtest-signed token is accepted in loadtest (anonymous and registered)", async () => {
    const anon = await call(
      "loadtest",
      "GET",
      "/v1/me",
      await loadtestToken({ sub: "lt-anon-1" }),
    );
    expect(anon.status).toBe(200);
    const a = MeResponse.parse(await anon.json());
    expect(a.user.isAnonymous).toBe(true);

    const reg = await call(
      "loadtest",
      "GET",
      "/v1/me",
      await loadtestToken({
        sub: "lt-owner-1",
        provider: "phone",
        phone: "+919999900001",
      }),
    );
    expect(reg.status).toBe(200);
    const r = MeResponse.parse(await reg.json());
    expect(r.user.isAnonymous).toBe(false);
  });

  it("loadtest without the secret rejects loadtest tokens (401)", async () => {
    const tok = await loadtestToken({ sub: "lt-nosecret" });
    const res = await call("loadtest", "GET", "/v1/me", tok, {
      LOADTEST_JWKS: undefined,
    });
    expect(res.status).toBe(401);
  });

  it("a Firebase token still works in loadtest (and in dev)", async () => {
    const tok = await firebaseToken("fb-user-in-loadtest");
    expect((await call("loadtest", "GET", "/v1/me", tok)).status).toBe(200);
    expect((await call("dev", "GET", "/v1/me", tok)).status).toBe(200);
  });

  it.each([
    ["wrong issuer", { iss: "someone-else" }],
    ["wrong audience", { aud: "qpeer-f6dbe" }],
    ["expired", { expSecondsFromNow: -120 }],
  ] as const)("rejects a loadtest token with %s (401)", async (_name, o) => {
    const tok = await loadtestToken({ sub: "lt-bad", ...o });
    expect((await call("loadtest", "GET", "/v1/me", tok)).status).toBe(401);
  });

  it("rejects a token signed by another key that claims the loadtest issuer (401)", async () => {
    const tok = await loadtestToken({ sub: "lt-forged", key: otherKey });
    expect((await call("loadtest", "GET", "/v1/me", tok)).status).toBe(401);
  });

  it("a secret holding a private key is a config error (500), never accepted", async () => {
    const priv = await exportJWK(loadtestKey.privateKey);
    const tok = await loadtestToken({ sub: "lt-privjwks" });
    const res = await call("loadtest", "GET", "/v1/me", tok, {
      LOADTEST_JWKS: JSON.stringify({ keys: [{ ...priv, kid: "lt-1" }] }),
    });
    expect(res.status).toBe(500);
  });

  it("verifierForEnv outside loadtest sends loadtest tokens to the Firebase verifier", async () => {
    const verify = verifierForEnv(
      {
        FIREBASE_PROJECT_ID: TEST_PROJECT_ID,
        ENVIRONMENT: "dev",
        LOADTEST_JWKS: loadtestJwks,
      },
      createLocalJWKSet({ keys: [firebaseJwk] }),
    );
    await expect(verify(await loadtestToken({ sub: "x" }))).rejects.toThrow();
  });
});

describe("Loadtest push sender (Step 3.5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const message = {
    to: "ExponentPushToken[lt-device]",
    title: "t",
    body: "b",
    data: { tokenId: "tok", queueId: "q", kind: "called" as const },
    channelId: "queue-alerts",
    priority: "high" as const,
    sound: "default" as const,
  };

  it("records instead of calling Expo when ENVIRONMENT=loadtest", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const t = pushTransport({ ENVIRONMENT: "loadtest" });
    const tickets = await t.send([message, message]);
    expect(tickets).toHaveLength(2);
    for (const ticket of tickets) {
      expect(ticket.status).toBe("ok");
      if (ticket.status === "ok") {
        expect(ticket.id.startsWith(LOADTEST_TICKET_PREFIX)).toBe(true);
      }
    }
    const receipts = await t.getReceipts(["a", "b"]);
    expect(receipts).toEqual({ a: { status: "ok" }, b: { status: "ok" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["local", "dev", "demo"])(
    "uses the real Expo transport when ENVIRONMENT=%s",
    async (environment) => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          Response.json({ data: [{ status: "ok", id: "expo-ticket" }] }),
        );
      const t = pushTransport({ ENVIRONMENT: environment });
      const tickets = await t.send([message]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("exp.host");
      expect(tickets).toEqual([{ status: "ok", id: "expo-ticket" }]);
    },
  );
});

describe("Loadtest routes (Step 3.5)", () => {
  it.each(["local", "dev", "demo"])(
    "are 404 when ENVIRONMENT=%s (Firebase token)",
    async (environment) => {
      const tok = await firebaseToken(`fb-lt-routes-${environment}`);
      for (const [method, path] of [
        ["GET", "/v1/loadtest/stats"],
        ["GET", "/v1/loadtest/queues/x/audit"],
        ["POST", "/v1/loadtest/reset"],
      ]) {
        const res = await call(environment, method, path, tok);
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    },
  );

  it("are 404 in loadtest for a Firebase-verified caller", async () => {
    const tok = await firebaseToken("fb-lt-routes-loadtest");
    for (const [method, path] of [
      ["GET", "/v1/loadtest/stats"],
      ["POST", "/v1/loadtest/reset"],
    ]) {
      expect((await call("loadtest", method, path, tok)).status).toBe(404);
    }
  });

  it("are 401 without a token", async () => {
    expect(
      (await call("loadtest", "GET", "/v1/loadtest/stats", null)).status,
    ).toBe(401);
  });

  it("audit returns DO and D1 tokens that agree after the outbox drains; stats count pushes", async () => {
    const { queueId, stub } = await seedQueue();
    const userId = `lt-audit-user-${crypto.randomUUID()}`;
    must(await stub.allocate({ method: "walkin", userId, cls: "regular" }));
    must(
      await stub.allocate({
        method: "walkin",
        userId: `${userId}-2`,
        cls: "regular",
      }),
    );
    must(await stub.next(1));
    expect(await stub.pendingOutbox()).toBe(0);

    const tok = await loadtestToken({ sub: "lt-auditor" });
    const res = await call(
      "loadtest",
      "GET",
      `/v1/loadtest/queues/${queueId}/audit`,
      tok,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      do: {
        status: string;
        waiting: number;
        pendingOutbox: number;
        tokens: { id: string; state: string; rev: number; number: number }[];
      };
      d1Tokens: { id: string; state: string; rev: number }[];
    };
    expect(body.do.status).toBe("open");
    expect(body.do.waiting).toBe(1);
    expect(body.do.tokens.map((t) => t.number)).toEqual([1, 2]);
    const d1 = new Map(body.d1Tokens.map((t) => [t.id, t]));
    for (const t of body.do.tokens) {
      expect(d1.get(t.id)?.state).toBe(t.state);
      expect(d1.get(t.id)?.rev).toBe(t.rev);
    }

    const missing = await call(
      "loadtest",
      "GET",
      "/v1/loadtest/queues/nope/audit",
      tok,
    );
    expect(missing.status).toBe(404);

    // Push rows written by the loadtest sender are counted per (token, kind).
    await addDevice(userId, `ExponentPushToken[lt-${userId}]`);
    await env.DB.prepare(
      `INSERT INTO push_tickets (id, token_id, expo_push_token, kind, sent_at, receipt_checked_at, status, created_at, updated_at)
       VALUES (?, 'tok-a', 'x', 'called', 1, NULL, 'sent', 1, 1), (?, 'tok-a', 'x', 'called', 1, NULL, 'sent', 1, 1),
              ('expo-real', 'tok-a', 'x', 'called', 1, NULL, 'sent', 1, 1)`,
    )
      .bind(`${LOADTEST_TICKET_PREFIX}1`, `${LOADTEST_TICKET_PREFIX}2`)
      .run();
    const stats = await call("loadtest", "GET", "/v1/loadtest/stats", tok);
    expect(stats.status).toBe(200);
    const s = (await stats.json()) as {
      pushes: { tokenId: string; kind: string; count: number }[];
      queues: { queueId: string; pendingOutbox: number; waiting: number }[];
    };
    expect(s.pushes.find((p) => p.tokenId === "tok-a")?.count).toBe(2);
    expect(s.queues.find((q) => q.queueId === queueId)?.waiting).toBe(1);
  });

  it("reset closes every queue, then wipes the loadtest tables", async () => {
    const { queueId, stub } = await seedQueue();
    must(
      await stub.allocate({
        method: "walkin",
        userId: "lt-reset-user",
        cls: "regular",
      }),
    );
    const tok = await loadtestToken({ sub: "lt-resetter" });
    let res = await call("loadtest", "POST", "/v1/loadtest/reset", tok);
    for (let i = 0; i < 5 && res.status === 409; i++) {
      res = await call("loadtest", "POST", "/v1/loadtest/reset", tok);
    }
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      done: boolean;
      wiped: Record<string, number>;
    };
    expect(body.done).toBe(true);
    expect(Object.keys(body.wiped)).toEqual([...RESET_TABLES]);
    expect((await stub.getSummary()).status).toBe("closed");
    for (const t of RESET_TABLES) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{
        n: number;
      }>();
      expect(row?.n, t).toBe(0);
    }
    expect(queueId).toBeTruthy();
  });
});
