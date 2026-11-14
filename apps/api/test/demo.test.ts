import { env } from "cloudflare:workers";
import {
  AnalyticsResponse,
  BusinessView,
  DemoHistoryResponse,
  DemoQueuesResponse,
  DemoResetResponse,
  DemoSeedResponse,
  EarningsResponse,
  MeResponse,
  QueueView,
} from "@qpeer/shared";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Bindings } from "../src/env";
import {
  DEMO_AUDIENCE,
  DEMO_ISSUER,
  demoEnabled,
} from "../src/middleware/demo-auth";
import { DEMO_CATALOG } from "../src/modules/demo/catalog";
import { TEST_PROJECT_ID, TestClock } from "./helpers";

/**
 * Step 5 demo tools: the demo key works only on demo/dev/local, its users are
 * namespaced `demo:`, the helper routes are invisible to everyone else, and a
 * reset deletes only demo rows.
 */

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 12, 10, 0); // Thu 12 Nov 2026, 3:30 PM IST

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let demoKey: KeyPair;
let demoJwks: string;
let firebaseKey: KeyPair;
let firebaseJwk: JWK;
const clock = new TestClock(NOW);

beforeAll(async () => {
  demoKey = await generateKeyPair("RS256", { extractable: true });
  demoJwks = JSON.stringify({
    keys: [
      {
        ...(await exportJWK(demoKey.publicKey)),
        kid: "demo-1",
        alg: "RS256",
        use: "sig",
      },
    ],
  });
  firebaseKey = await generateKeyPair("RS256");
  firebaseJwk = {
    ...(await exportJWK(firebaseKey.publicKey)),
    kid: "fb-1",
    alg: "RS256",
    use: "sig",
  };
});

async function demoToken(
  sub: string,
  o: { registered?: boolean; iss?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    firebase: { sign_in_provider: o.registered ? "phone" : "anonymous" },
    ...(o.registered ? { phone_number: "+919000000001" } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "demo-1" })
    .setSubject(sub)
    .setIssuer(o.iss ?? DEMO_ISSUER)
    .setAudience(DEMO_AUDIENCE)
    .setIssuedAt(now - 10)
    .setExpirationTime(now + 3600)
    .sign(demoKey.privateKey);
}

async function firebaseToken(sub: string, phone?: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    auth_time: now - 60,
    firebase: { sign_in_provider: "phone" },
    ...(phone ? { phone_number: phone } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "fb-1" })
    .setSubject(sub)
    .setIssuer(`https://securetoken.google.com/${TEST_PROJECT_ID}`)
    .setAudience(TEST_PROJECT_ID)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 3600)
    .sign(firebaseKey.privateKey);
}

const app = () =>
  createApp({
    firebaseKeys: createLocalJWKSet({ keys: [firebaseJwk] }),
    clock,
  });

async function call(
  environment: string,
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  extra: Partial<Bindings> = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app().fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    {
      ...env,
      FIREBASE_PROJECT_ID: TEST_PROJECT_ID,
      ENVIRONMENT: environment,
      DEMO_JWKS: demoJwks,
      LOADTEST_JWKS: undefined,
      ...extra,
    },
  );
}

async function json<T>(
  res: Response,
  status: number,
  schema: { parse(v: unknown): T },
) {
  const raw = await res.text();
  expect(res.status, raw).toBe(status);
  return schema.parse(JSON.parse(raw));
}

describe("Demo auth isolation (DEM-06)", () => {
  it.each(["loadtest", "production", "", "DEMO", "demo "])(
    "a demo-signed token is 401 when ENVIRONMENT=%j",
    async (environment) => {
      const res = await call(
        environment,
        "GET",
        "/v1/me",
        await demoToken("iso"),
      );
      expect(res.status).toBe(401);
    },
  );

  it("demoEnabled needs demo/dev/local and a non-empty secret", () => {
    for (const e of ["demo", "dev", "local"]) {
      expect(demoEnabled({ ENVIRONMENT: e, DEMO_JWKS: "{}" })).toBe(true);
      expect(demoEnabled({ ENVIRONMENT: e, DEMO_JWKS: " " })).toBe(false);
      expect(demoEnabled({ ENVIRONMENT: e })).toBe(false);
    }
    expect(demoEnabled({ ENVIRONMENT: "loadtest", DEMO_JWKS: "{}" })).toBe(
      false,
    );
  });

  it("accepted on demo and dev; the uid is namespaced so it can't be a real person", async () => {
    for (const e of ["demo", "dev"]) {
      const me = await json(
        await call(
          e,
          "GET",
          "/v1/me",
          await demoToken("real-firebase-uid", { registered: true }),
        ),
        200,
        MeResponse,
      );
      expect(me.user.isAnonymous).toBe(false);
    }
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE firebase_uid = 'demo:real-firebase-uid'",
    ).first<{ n: number }>();
    expect(row?.n).toBe(1);
    // without the secret: 401
    const res = await call(
      "demo",
      "GET",
      "/v1/me",
      await demoToken("x"),
      undefined,
      {
        DEMO_JWKS: undefined,
      },
    );
    expect(res.status).toBe(401);
  });

  it("demo routes are 404 for Firebase users (even on demo) and outside demo/dev/local", async () => {
    const fb = await firebaseToken("fb-demo-probe");
    expect((await call("demo", "GET", "/v1/demo/queues", fb)).status).toBe(404);
    expect((await call("demo", "POST", "/v1/demo/reset", fb, {})).status).toBe(
      404,
    );
    expect(
      (await call("loadtest", "GET", "/v1/demo/queues", await demoToken("o")))
        .status,
    ).toBe(401);
    expect(
      (await call("dev", "GET", "/v1/demo/queues", await demoToken("o")))
        .status,
    ).toBe(200);
  });
});

describe("Demo seed, history and reset (DEM-01…05)", () => {
  it("seeds, shows on Insights for a phone owner, and resets only demo rows", async () => {
    const owner = await demoToken("owner", { registered: true });
    // A real (Firebase) phone account that signed in once.
    const phoneUser = await firebaseToken("fb-phone-owner", "+919811111111");
    await call("dev", "GET", "/v1/me", phoneUser);
    // A real business on dev that a reset must never touch.
    const real = await json(
      await call("dev", "POST", "/v1/businesses", phoneUser, {
        name: "Real Clinic",
        category: "clinic",
        location: { lat: 32.73, lng: 74.86 },
      }),
      201,
      BusinessView,
    );
    await json(
      await call("dev", "POST", `/v1/businesses/${real.id}/queues`, phoneUser, {
        name: "OPD",
      }),
      201,
      QueueView,
    );

    // DEM-01: every business of the catalogue (one request each).
    const seeded: DemoSeedResponse[] = [];
    for (let i = 1; i <= DEMO_CATALOG.length; i++) {
      seeded.push(
        await json(
          await call("dev", "POST", "/v1/demo/seed", owner, {
            businessIndex: i,
            ownerPhones: ["+919811111111", "+919800000000"],
          }),
          200,
          DemoSeedResponse,
        ),
      );
    }
    expect(seeded[0]?.catalogSize).toBeGreaterThanOrEqual(8);
    expect(seeded[0]?.catalogSize).toBeLessThanOrEqual(15);
    expect(seeded[0]).toMatchObject({
      created: true,
      ownersAdded: ["+919811111111"],
      ownersMissing: ["+919800000000"],
    });
    const cats = new Set(DEMO_CATALOG.map((b) => b.category));
    expect(cats).toEqual(
      new Set(["clinic", "lab", "service_centre", "salon", "other"]),
    );
    for (const b of DEMO_CATALOG) {
      expect(Math.abs(b.lat - 32.73)).toBeLessThan(0.08);
      expect(Math.abs(b.lng - 74.86)).toBeLessThan(0.08);
    }
    // idempotent
    const again = await json(
      await call("dev", "POST", "/v1/demo/seed", owner, { businessIndex: 1 }),
      200,
      DemoSeedResponse,
    );
    expect(again.created).toBe(false);
    await json(
      await call("dev", "POST", "/v1/demo/seed", owner, { businessIndex: 99 }),
      400,
      { parse: (v) => v },
    );

    const list = await json(
      await call("dev", "GET", "/v1/demo/queues", owner),
      200,
      DemoQueuesResponse,
    );
    expect(list.queues).toHaveLength(
      DEMO_CATALOG.reduce((s, b) => s + b.queues.length, 0),
    );
    expect(list.queues.some((q) => q.priorityEnabled)).toBe(true);

    // DEM-02/03: history for business 1.
    const hist = await json(
      await call("dev", "POST", "/v1/demo/seed/history", owner, {
        businessIndex: 1,
        weeks: 6,
      }),
      200,
      DemoHistoryResponse,
    );
    expect(hist.analyticsRows).toBeGreaterThan(300);
    expect(hist.payments).toBeGreaterThan(10);
    // again: replaced, not doubled
    const hist2 = await json(
      await call("dev", "POST", "/v1/demo/seed/history", owner, {
        businessIndex: 1,
        weeks: 6,
      }),
      200,
      DemoHistoryResponse,
    );
    expect(hist2).toEqual(hist);
    const counted = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM analytics_hourly WHERE business_id = ?1) AS a, (SELECT COUNT(*) FROM payments WHERE business_id = ?1) AS p",
    )
      .bind(hist.businessId)
      .first<{ a: number; p: number }>();
    expect(counted).toEqual({ a: hist.analyticsRows, p: hist.payments });
    // the last finished IST hour at most
    const last = await env.DB.prepare(
      "SELECT MAX(hour_start) AS m FROM analytics_hourly WHERE business_id = ?",
    )
      .bind(hist.businessId)
      .first<{ m: number }>();
    expect((last?.m ?? 0) + HOUR).toBeLessThanOrEqual(NOW);

    // The phone owner sees it in Insights (analytics + earnings).
    const a = await json(
      await call(
        "dev",
        "GET",
        `/v1/businesses/${hist.businessId}/analytics?range=28`,
        phoneUser,
      ),
      200,
      AnalyticsResponse,
    );
    expect(a.hasData).toBe(true);
    expect(a.insights.length).toBeGreaterThan(0);
    const e = await json(
      await call(
        "dev",
        "GET",
        `/v1/businesses/${hist.businessId}/earnings?range=28`,
        phoneUser,
      ),
      200,
      EarningsResponse,
    );
    expect(e.totals.capturedPaise).toBeGreaterThan(0);
    expect(e.totals.forfeits + e.totals.refunds).toBeGreaterThan(0);
    // public stats show (first_listed_at long ago)
    const pub = await json(
      await call(
        "dev",
        "GET",
        `/v1/businesses/${hist.businessId}`,
        await firebaseToken("fb-stranger"),
      ),
      200,
      BusinessView,
    );
    expect(pub.stats?.servedCount).toBeGreaterThan(0);

    // DEM-04 helper: passes only on demo queues
    expect(
      (
        await call(
          "dev",
          "POST",
          `/v1/demo/queues/${real.id}/priority-pass`,
          owner,
        )
      ).status,
    ).toBe(404);

    // wipeAll is refused on dev
    expect(
      (await call("dev", "POST", "/v1/demo/reset", owner, { wipeAll: true }))
        .status,
    ).toBe(403);

    // DEM-05: reset (retry while outboxes drain)
    let r: DemoResetResponse | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await call("dev", "POST", "/v1/demo/reset", owner);
      r = DemoResetResponse.parse(await res.json());
      if (r.done) break;
    }
    expect(r?.done).toBe(true);
    expect(r?.deleted.businesses).toBe(DEMO_CATALOG.length);
    const left = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM businesses WHERE id LIKE 'de300000-%') AS b,
         (SELECT COUNT(*) FROM analytics_hourly WHERE business_id LIKE 'de300000-%') AS a,
         (SELECT COUNT(*) FROM ledger_entries WHERE business_id LIKE 'de300000-%') AS l,
         (SELECT COUNT(*) FROM users WHERE firebase_uid LIKE 'demo:%') AS u,
         (SELECT COUNT(*) FROM businesses WHERE id = ?) AS realBiz,
         (SELECT COUNT(*) FROM users WHERE firebase_uid = 'fb-phone-owner') AS realUser`,
    )
      .bind(real.id)
      .first();
    expect(left).toEqual({ b: 0, a: 0, l: 0, u: 0, realBiz: 1, realUser: 1 });
  });
});
