import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  BusinessView,
  CancelResponse,
  ConsoleState,
  MyTokensResponse,
  OkResponse,
  QueueInfoResponse,
  QueueView,
  TokenView,
  TriageResponse,
} from "@qpeer/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CRON_DAILY,
  CRON_HOURLY,
  CRON_QUARTER_HOUR,
  dueSchedules,
  runScheduled,
} from "../src/cron/jobs";
import { pushOverride } from "../src/modules/notifications/expo-push";
import type { QueueDO } from "../src/queue/queue-do";
import { expectError, expectOk, makeTestApi } from "./helpers";
import {
  collect,
  fakePush,
  JAMMU,
  MIN,
  stubFor,
  waitFor,
} from "./queue-helpers";

type Api = Awaited<ReturnType<typeof makeTestApi>>;

let api: Api;
let owner: string;
let rival: string; // owner of another business
let customer: string;
let other: string;
let anon: string;
let push: ReturnType<typeof fakePush>;

const NEAR = { lat: JAMMU.lat, lng: JAMMU.lng, accuracyM: 20, mocked: false };

beforeAll(async () => {
  api = await makeTestApi();
  owner = await api.token({ sub: "q-owner" });
  rival = await api.token({ sub: "q-rival" });
  customer = await api.token({ sub: "q-customer" });
  other = await api.token({ sub: "q-other" });
  anon = await api.token({ sub: "q-anon", anonymous: true });
  push = fakePush();
  pushOverride.transport = push.transport;
});

async function userId(tok: string): Promise<string> {
  const res = await api.call("GET", "/v1/me", tok);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

/** Listed business with one queue; opened unless `open: false`. */
async function setup(
  opts: {
    settings?: Record<string, number>;
    open?: boolean;
    tok?: string;
  } = {},
) {
  const tok = opts.tok ?? owner;
  const biz = await expectOk(
    await api.call("POST", "/v1/businesses", tok, {
      name: "Live Clinic",
      category: "clinic",
      location: JAMMU,
    }),
    201,
    BusinessView,
  );
  const queue = await expectOk(
    await api.call("POST", `/v1/businesses/${biz.id}/queues`, tok, {
      name: "OPD",
      ...(opts.settings ? { settings: opts.settings } : {}),
    }),
    201,
    QueueView,
  );
  if (opts.open !== false) {
    await expectOk(
      await api.call("POST", `/v1/queues/${queue.id}/open`, tok),
      200,
      ConsoleState,
    );
  }
  return { biz, queue, q: queue.id };
}

async function join(q: string, tok: string, body: unknown = NEAR) {
  return api.call("POST", `/v1/queues/${q}/join`, tok, body);
}

async function joinOk(q: string, tok: string) {
  return expectOk(await join(q, tok), 201, TokenView);
}

async function consoleOf(q: string) {
  return expectOk(
    await api.call("GET", `/v1/queues/${q}/console`, owner),
    200,
    ConsoleState,
  );
}

describe("Walk-in join (JON-03…07)", () => {
  it("JON-03: GET /queues/:id carries the live summary", async () => {
    const { q } = await setup();
    await joinOk(q, customer);
    const info = await expectOk(
      await api.call("GET", `/v1/queues/${q}`, other),
      200,
      QueueInfoResponse,
    );
    expect(info.live.status).toBe("open");
    expect(info.live.waiting).toBe(1);
    expect(info.live.waitLowMs as number).toBeLessThan(
      info.live.waitHighMs as number,
    );
  });

  it("JON-05: each rejection code, in the documented order", async () => {
    // not found / not listed
    await expectError(
      await join(crypto.randomUUID(), customer),
      404,
      "not_found",
    );
    const unpinned = await expectOk(
      await api.call("POST", "/v1/businesses", owner, {
        name: "No Pin",
        category: "lab",
      }),
      201,
      BusinessView,
    );
    const hidden = await expectOk(
      await api.call("POST", `/v1/businesses/${unpinned.id}/queues`, owner, {
        name: "Q",
      }),
      201,
      QueueView,
    );
    await expectError(await join(hidden.id, customer), 404, "not_found");

    // closed / paused / full (state checks come before the location checks)
    const { q } = await setup({ open: false, settings: { maxSize: 10 } });
    const far = { ...NEAR, lat: JAMMU.lat + 0.009 };
    await expectError(await join(q, customer, far), 409, "queue_closed");
    await api.call("POST", `/v1/queues/${q}/open`, owner);
    await api.call("POST", `/v1/queues/${q}/pause`, owner);
    await expectError(await join(q, customer, far), 409, "queue_paused");
    await api.call("POST", `/v1/queues/${q}/resume`, owner);

    // location checks
    await expectError(
      await join(q, customer, { ...far, mocked: true }),
      422,
      "mock_location",
    );
    await expectError(
      await join(q, customer, { ...NEAR, accuracyM: 1500 }),
      422,
      "no_location_fix",
    );
    const tooFar = await expectError(
      await join(q, customer, far),
      422,
      "too_far",
    );
    expect(tooFar.details).toEqual({ distanceM: 1001, joinRadiusM: 150 });
    // distance − accuracy within the radius is accepted
    const edge = { ...NEAR, lat: JAMMU.lat + 0.0018, accuracyM: 60 }; // ~200 m
    const ok = await expectOk(await join(q, customer, edge), 201, TokenView);
    expect(ok.state).toBe("WAITING");

    // already in queue (returns the existing token id)
    const dup = await expectError(
      await join(q, customer),
      409,
      "already_in_queue",
    );
    expect(dup.details).toEqual({ tokenId: ok.id });

    // bad body
    await expectError(await join(q, other, { lat: 1 }), 400, "invalid_input");

    // full
    for (let i = 0; i < 9; i++) {
      await joinOk(q, await api.token({ sub: `filler-${q}-${i}` }));
    }
    await expectError(await join(q, other), 409, "queue_full");
  });

  it("JON-07: a free-lane block → 423 free_lane_blocked with until", async () => {
    const { q } = await setup();
    const blocked = await api.token({ sub: "q-blocked" });
    const id = await userId(blocked);
    const until = api.clock.t + 3 * 24 * 60 * MIN;
    await env.DB.prepare(
      "UPDATE users SET free_lane_blocked_until = ? WHERE id = ?",
    )
      .bind(until, id)
      .run();
    const err = await expectError(
      await join(q, blocked),
      423,
      "free_lane_blocked",
    );
    expect(err.details).toEqual({ until });
    // expired block → can join again
    await env.DB.prepare(
      "UPDATE users SET free_lane_blocked_until = ? WHERE id = ?",
    )
      .bind(api.clock.t - 1, id)
      .run();
    await joinOk(q, blocked);
  });

  it("JON-04/NFR-10: the location is not stored (D1, DO storage) or logged", async () => {
    const { q } = await setup();
    const spot = {
      lat: 32.72671234,
      lng: 74.85712345,
      accuracyM: 17.5,
      mocked: false,
    };
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    const tok = await expectOk(await join(q, other, spot), 201, TokenView);
    const far = { ...spot, lat: 32.73671234 };
    await expectError(await join(q, anon, far), 422, "too_far");
    const logged = JSON.stringify([...log.mock.calls, ...err.mock.calls]);
    log.mockRestore();
    err.mockRestore();
    const needles = ["32.7267123", "74.8571234", "32.7367123"];
    for (const n of needles) expect(logged).not.toContain(n);

    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    ).all<{ name: string }>();
    let d1Dump = "";
    for (const { name } of tables.results) {
      const rows = await env.DB.prepare(`SELECT * FROM "${name}"`).all();
      d1Dump += JSON.stringify(rows.results);
    }
    expect(d1Dump).toContain(tok.id);
    for (const n of needles) expect(d1Dump).not.toContain(n);

    const doDump = await runInDurableObject(
      stubFor(q),
      (_i: QueueDO, state) => {
        const names = state.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
          )
          .toArray();
        return names
          .map((t) =>
            JSON.stringify(
              state.storage.sql.exec(`SELECT * FROM "${t.name}"`).toArray(),
            ),
          )
          .join("");
      },
    );
    expect(doDump).toContain(tok.id);
    for (const n of needles) expect(doDump).not.toContain(n);
  });

  it("anonymous users can join as walk-ins", async () => {
    const { q } = await setup();
    const t = await joinOk(q, anon);
    expect(t.method).toBe("walkin");
  });

  it("decision: staff/owners may join their own queue as customers", async () => {
    const { q } = await setup();
    const t = await joinOk(q, owner);
    expect(t.number).toBe(1);
  });
});

describe("Tokens (TOK-01, TOK-05, TOK-06)", () => {
  it("TOK-01: the owner reads the live view; staff of the business too; others get 404", async () => {
    const { q, biz } = await setup();
    await joinOk(q, other);
    const mine = await joinOk(q, customer);
    const v = await expectOk(
      await api.call("GET", `/v1/tokens/${mine.id}`, customer),
      200,
      TokenView,
    );
    expect(v).toMatchObject({
      id: mine.id,
      queueId: q,
      businessId: biz.id,
      businessName: "Live Clinic",
      queueName: "OPD",
      number: 2,
      label: "2",
      state: "WAITING",
      peopleAhead: 1,
      queueStatus: "open",
      counter: null,
      paid: false,
    });
    expect(v.etaLowMs as number).toBeLessThan(v.etaHighMs as number);
    await expectOk(
      await api.call("GET", `/v1/tokens/${mine.id}`, owner),
      200,
      TokenView,
    );
    await expectError(
      await api.call("GET", `/v1/tokens/${mine.id}`, other),
      404,
      "not_found",
    );
    await expectError(
      await api.call("GET", `/v1/tokens/${mine.id}`, rival),
      404,
      "not_found",
    );
    await expectError(
      await api.call("GET", `/v1/tokens/${crypto.randomUUID()}`, customer),
      404,
      "not_found",
    );
  });

  it("TOK-06: my tokens — active first, then recent history; empty state", async () => {
    const fresh = await api.token({ sub: "q-fresh" });
    const empty = await expectOk(
      await api.call("GET", "/v1/me/tokens", fresh),
      200,
      MyTokensResponse,
    );
    expect(empty.items).toEqual([]);
    const a = await setup();
    const b = await setup();
    const ta = await joinOk(a.q, fresh);
    const tb = await joinOk(b.q, fresh);
    await expectOk(
      await api.call("POST", `/v1/tokens/${ta.id}/leave`, fresh),
      200,
      TokenView,
    );
    const active = await expectOk(
      await api.call("GET", "/v1/me/tokens?status=active", fresh),
      200,
      MyTokensResponse,
    );
    expect(active.items.map((t) => t.id)).toEqual([tb.id]);
    expect(active.items[0]).toMatchObject({
      queueName: "OPD",
      businessName: "Live Clinic",
      state: "WAITING",
    });
    const recent = await expectOk(
      await api.call("GET", "/v1/me/tokens?status=recent", fresh),
      200,
      MyTokensResponse,
    );
    expect(recent.items.map((t) => [t.id, t.state, t.endReason])).toEqual([
      [ta.id, "LEFT", "left"],
    ]);
    await expectError(
      await api.call("GET", "/v1/me/tokens?status=all", fresh),
      400,
      "invalid_input",
    );
  });

  it("QUE-10/TOK-05: leave and cancel; another user can't leave someone's token (IDOR)", async () => {
    const { q } = await setup();
    const t = await joinOk(q, customer);
    await expectError(
      await api.call("POST", `/v1/tokens/${t.id}/leave`, other),
      404,
      "not_found",
    );
    await expectError(
      await api.call("POST", `/v1/tokens/${t.id}/cancel`, other),
      404,
      "not_found",
    );
    await expectError(
      await api.call("POST", `/v1/tokens/${t.id}/leave`, rival),
      404,
      "not_found",
    );
    const still = await expectOk(
      await api.call("GET", `/v1/tokens/${t.id}`, customer),
      200,
      TokenView,
    );
    expect(still.state).toBe("WAITING");
    const c = await expectOk(
      await api.call("POST", `/v1/tokens/${t.id}/cancel`, customer),
      200,
      CancelResponse,
    );
    expect(c.token.state).toBe("LEFT");
    expect(c.refund).toBe(false);
    // staff of the business can remove a token for the customer
    const t2 = await joinOk(q, customer);
    const left = await expectOk(
      await api.call("POST", `/v1/tokens/${t2.id}/leave`, owner),
      200,
      TokenView,
    );
    expect(left.state).toBe("LEFT");
    // repeating is idempotent; a finished token can't be left
    await expectOk(
      await api.call("POST", `/v1/tokens/${t2.id}/cancel`, customer),
      200,
      CancelResponse,
    );
    const t3 = await joinOk(q, customer);
    await api.call("POST", `/v1/queues/${q}/next`, owner);
    await api.call("POST", `/v1/queues/${q}/tokens/${t3.id}/served`, owner);
    await expectError(
      await api.call("POST", `/v1/tokens/${t3.id}/leave`, customer),
      409,
      "invalid_state",
    );
  });
});

describe("Console (staff)", () => {
  it("BIZ-13/QUE-05…12: the console drives the queue through the API", async () => {
    const { q } = await setup();
    const a = await joinOk(q, customer);
    const b = await joinOk(q, other);
    let c = await expectOk(
      await api.call("POST", `/v1/queues/${q}/next`, owner),
      200,
      ConsoleState,
    );
    expect(c.serving.map((t) => t.id)).toEqual([a.id]);
    c = await expectOk(
      await api.call("POST", `/v1/queues/${q}/undo-next`, owner),
      200,
      ConsoleState,
    );
    expect(c.serving).toEqual([]);
    c = await expectOk(
      await api.call("POST", `/v1/queues/${q}/next`, owner, { counter: 1 }),
      200,
      ConsoleState,
    );
    await expectError(
      await api.call("POST", `/v1/queues/${q}/next`, owner, { counter: 0 }),
      400,
      "invalid_input",
    );
    c = await expectOk(
      await api.call("POST", `/v1/queues/${q}/tokens/${a.id}/no-show`, owner),
      200,
      ConsoleState,
    );
    expect(c.grace.map((t) => t.id)).toEqual([a.id]);
    c = await expectOk(
      await api.call("POST", `/v1/queues/${q}/tokens/${a.id}/admit`, owner),
      200,
      ConsoleState,
    );
    c = await expectOk(
      await api.call("POST", `/v1/queues/${q}/tokens/${a.id}/served`, owner),
      200,
      ConsoleState,
    );
    expect(c.counts).toEqual({
      waiting: 1,
      inService: 0,
      grace: 0,
      total: 1,
      missed: 0,
      booked: 0,
    });
    c = await expectOk(
      await api.call("POST", `/v1/queues/${q}/tokens/${b.id}/skip`, owner),
      200,
      ConsoleState,
    );
    await expectError(
      await api.call("POST", `/v1/queues/${q}/tokens/${b.id}/served`, owner),
      409,
      "invalid_state",
    );
    await expectError(
      await api.call(
        "POST",
        `/v1/queues/${q}/tokens/${crypto.randomUUID()}/skip`,
        owner,
      ),
      404,
      "not_found",
    );
    const tri = await expectOk(
      await api.call("POST", `/v1/queues/${q}/triage`, owner),
      201,
      TriageResponse,
    );
    expect(tri.console.waiting[0].label).toBe("T1");
    await expectOk(
      await api.call("POST", `/v1/queues/${q}/pause`, owner),
      200,
      ConsoleState,
    );
    await expectError(
      await api.call("POST", `/v1/queues/${q}/next`, owner),
      409,
      "queue_paused",
    );
    await expectOk(
      await api.call("POST", `/v1/queues/${q}/resume`, owner),
      200,
      ConsoleState,
    );
    c = await expectOk(
      await api.call("POST", `/v1/queues/${q}/close`, owner),
      200,
      ConsoleState,
    );
    expect(c.status).toBe("closed");
    const after = await expectOk(
      await api.call("GET", `/v1/tokens/${b.id}`, other),
      200,
      TokenView,
    );
    expect(after.state).toBe("EXPIRED");
  });

  it("IDOR: another business, a customer or an anonymous user can't drive the console (404), and nothing changes", async () => {
    const { q } = await setup();
    const t = await joinOk(q, customer);
    const before = await consoleOf(q);
    const attempts: [string, string][] = [
      ["POST", "open"],
      ["POST", "close"],
      ["POST", "pause"],
      ["POST", "resume"],
      ["POST", "next"],
      ["POST", "undo-next"],
      ["POST", "triage"],
      ["GET", "console"],
      ["POST", `tokens/${t.id}/skip`],
      ["POST", `tokens/${t.id}/no-show`],
      ["POST", `tokens/${t.id}/admit`],
      ["POST", `tokens/${t.id}/served`],
    ];
    for (const who of [rival, customer, anon]) {
      for (const [method, path] of attempts) {
        await expectError(
          await api.call(method, `/v1/queues/${q}/${path}`, who),
          404,
          "not_found",
        );
      }
    }
    const after = await consoleOf(q);
    expect({ ...after, updatedAt: 0, eta: null }).toEqual({
      ...before,
      updatedAt: 0,
      eta: null,
    });
    // unknown queue → same 404
    await expectError(
      await api.call("POST", `/v1/queues/${crypto.randomUUID()}/next`, owner),
      404,
      "not_found",
    );
  });

  it("BIZ-12: settings changes reach the DO and apply to new tokens only", async () => {
    const { q } = await setup({ settings: { graceMinutes: 10 } });
    const a = await joinOk(q, customer);
    await expectOk(
      await api.call("PATCH", `/v1/queues/${q}`, owner, {
        settings: { graceMinutes: 2 },
      }),
      200,
      QueueView,
    );
    const b = await joinOk(q, other);
    await api.call("POST", `/v1/queues/${q}/next`, owner);
    await api.call("POST", `/v1/queues/${q}/tokens/${a.id}/no-show`, owner);
    await api.call("POST", `/v1/queues/${q}/next`, owner);
    const c = await expectOk(
      await api.call("POST", `/v1/queues/${q}/tokens/${b.id}/no-show`, owner),
      200,
      ConsoleState,
    );
    const grace = Object.fromEntries(
      c.grace.map((g) => [g.id, (g.graceUntil as number) - c.updatedAt]),
    );
    expect(grace[a.id]).toBeGreaterThan(9 * MIN);
    expect(grace[b.id]).toBeLessThanOrEqual(2 * MIN);
  });

  it("BIZ-11: archive is refused while tokens are active", async () => {
    const { q } = await setup();
    const t = await joinOk(q, customer);
    await expectError(
      await api.call("POST", `/v1/queues/${q}/archive`, owner),
      409,
      "invalid_state",
    );
    await api.call("POST", `/v1/tokens/${t.id}/leave`, customer);
    const archived = await expectOk(
      await api.call("POST", `/v1/queues/${q}/archive`, owner),
      200,
      QueueView,
    );
    expect(archived.status).toBe("archived");
    await expectError(
      await api.call("POST", `/v1/queues/${q}/open`, owner),
      409,
      "invalid_state",
    );
  });

  it("BIZ-08: deactivating the business closes its open queues", async () => {
    const { q, biz } = await setup();
    const t = await joinOk(q, customer);
    await expectOk(
      await api.call("POST", `/v1/businesses/${biz.id}/deactivate`, owner),
      200,
      BusinessView,
    );
    const c = await consoleOf(q);
    expect(c.status).toBe("closed");
    const v = await expectOk(
      await api.call("GET", `/v1/tokens/${t.id}`, customer),
      200,
      TokenView,
    );
    expect(v.state).toBe("EXPIRED");
    expect(v.endReason).toBe("closed");
    await expectError(
      await api.call("POST", `/v1/queues/${q}/open`, owner),
      409,
      "invalid_state",
    );
    await expectOk(
      await api.call("POST", `/v1/businesses/${biz.id}/activate`, owner),
      200,
      BusinessView,
    );
    expect((await consoleOf(q)).status).toBe("closed"); // stays closed until opened
  });

  it("QUE-18: the public business view includes each queue's snapshot; it follows a pin move", async () => {
    const { q, biz } = await setup();
    const liveOf = async () =>
      (
        await expectOk(
          await api.call("GET", `/v1/businesses/${biz.id}`, anon),
          200,
          BusinessView,
        )
      ).queues.find((x) => x.id === q)?.live;
    // open/close/pause flush at once
    expect(await liveOf()).toMatchObject({ status: "open", waiting: 0 });
    // joins within 30 s of the last flush wait for the throttled flush (alarm)
    await joinOk(q, customer);
    await joinOk(q, other);
    expect(await liveOf()).toMatchObject({ waiting: 0 });
    await stubFor(q).testAdvanceClock(31_000);
    await runDurableObjectAlarm(stubFor(q));
    expect(await liveOf()).toMatchObject({ status: "open", waiting: 2 });
    const moved = { lat: JAMMU.lat + 0.01, lng: JAMMU.lng };
    await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, {
      location: moved,
    });
    const snap = await env.DB.prepare(
      "SELECT lat FROM queue_snapshots WHERE queue_id = ?",
    )
      .bind(q)
      .first<{ lat: number }>();
    expect(snap?.lat).toBeCloseTo(moved.lat, 6);
  });
});

describe("Live socket route (TOK-02)", () => {
  const upgrade = (path: string, tok: string | null) => {
    const headers: Record<string, string> = { Upgrade: "websocket" };
    if (tok) headers.Authorization = `Bearer ${tok}`;
    return api.app.fetch(
      new Request(`http://localhost${path}`, { headers }),
      env,
    );
  };

  it("the token owner gets a socket with updates; others get 404", async () => {
    const { q } = await setup();
    await joinOk(q, other);
    const t = await joinOk(q, customer);
    const res = await upgrade(`/v1/queues/${q}/live?tokenId=${t.id}`, customer);
    expect(res.status).toBe(101);
    const { ws, messages } = collect(res);
    await waitFor(() => messages.find((m) => m.type === "token"));
    await api.call("POST", `/v1/queues/${q}/next`, owner);
    await waitFor(() =>
      messages.find((m) => m.type === "token" && m.token.peopleAhead === 0),
    );
    ws.close();

    expect(
      (await upgrade(`/v1/queues/${q}/live?tokenId=${t.id}`, other)).status,
    ).toBe(404);
    expect(
      (await upgrade(`/v1/queues/${q}/live?tokenId=${t.id}`, owner)).status,
    ).toBe(404);
    expect(
      (await upgrade(`/v1/queues/${q}/live?tokenId=${t.id}`, null)).status,
    ).toBe(401);
    expect((await upgrade(`/v1/queues/${q}/live`, customer)).status).toBe(400);
    await expectError(
      await api.call("GET", `/v1/queues/${q}/live?tokenId=${t.id}`, customer),
      400,
      "invalid_input",
    );
    // a token of another queue can't be watched through this queue
    const other2 = await setup();
    expect(
      (await upgrade(`/v1/queues/${other2.q}/live?tokenId=${t.id}`, customer))
        .status,
    ).toBe(404);
  });

  it("staff get a console socket; non-staff get 404", async () => {
    const { q } = await setup();
    const res = await upgrade(`/v1/queues/${q}/live?console=1`, owner);
    expect(res.status).toBe(101);
    const { ws, messages } = collect(res);
    await waitFor(() => messages.find((m) => m.type === "queue"));
    await joinOk(q, customer);
    await waitFor(() =>
      messages.find(
        (m) => m.type === "queue" && m.console.counts.waiting === 1,
      ),
    );
    ws.close();
    expect(
      (await upgrade(`/v1/queues/${q}/live?console=1`, rival)).status,
    ).toBe(404);
    expect(
      (await upgrade(`/v1/queues/${q}/live?console=1`, customer)).status,
    ).toBe(404);
  });
});

describe("Devices and push receipts (ALR-02)", () => {
  it("POST /me/devices upserts (moves between users); DELETE only removes my own", async () => {
    const tok = `ExponentPushToken[dev-${crypto.randomUUID()}]`;
    await expectOk(
      await api.call("POST", "/v1/me/devices", customer, {
        expoPushToken: tok,
        platform: "android",
      }),
      200,
      OkResponse,
    );
    await expectOk(
      await api.call("POST", "/v1/me/devices", customer, {
        expoPushToken: tok,
        platform: "android",
      }),
      200,
      OkResponse,
    );
    const owner1 = await env.DB.prepare(
      "SELECT user_id FROM devices WHERE expo_push_token = ?",
    )
      .bind(tok)
      .first<{ user_id: string }>();
    expect(owner1?.user_id).toBe(await userId(customer));
    await expectError(
      await api.call("POST", "/v1/me/devices", customer, {
        expoPushToken: "nope",
        platform: "android",
      }),
      400,
      "invalid_input",
    );
    // someone else's delete does nothing
    await api.call(
      "DELETE",
      `/v1/me/devices/${encodeURIComponent(tok)}`,
      other,
    );
    expect(
      await env.DB.prepare(
        "SELECT 1 AS x FROM devices WHERE expo_push_token = ?",
      )
        .bind(tok)
        .first(),
    ).not.toBeNull();
    // re-registered by another user → moves
    await api.call("POST", "/v1/me/devices", other, {
      expoPushToken: tok,
      platform: "ios",
    });
    const moved = await env.DB.prepare(
      "SELECT user_id, platform FROM devices WHERE expo_push_token = ?",
    )
      .bind(tok)
      .first<{ user_id: string; platform: string }>();
    expect(moved).toEqual({ user_id: await userId(other), platform: "ios" });
    await expectOk(
      await api.call(
        "DELETE",
        `/v1/me/devices/${encodeURIComponent(tok)}`,
        other,
      ),
      200,
      OkResponse,
    );
    expect(
      await env.DB.prepare(
        "SELECT 1 AS x FROM devices WHERE expo_push_token = ?",
      )
        .bind(tok)
        .first(),
    ).toBeNull();
  });

  it("hourly cron checks receipts older than 15 min and deletes DeviceNotRegistered devices", async () => {
    const now = Date.now();
    const dead = `ExponentPushToken[cron-dead-${crypto.randomUUID()}]`;
    const alive = `ExponentPushToken[cron-ok-${crypto.randomUUID()}]`;
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const t of [dead, alive]) {
      await env.DB.prepare(
        "INSERT INTO devices (expo_push_token, user_id, platform, last_seen_at, created_at, updated_at) VALUES (?, 'u', 'android', ?, ?, ?)",
      )
        .bind(t, now, now, now)
        .run();
    }
    const ticket = (id: string, to: string, sentAt: number) =>
      env.DB.prepare(
        "INSERT INTO push_tickets (id, token_id, expo_push_token, kind, sent_at, status, created_at, updated_at) VALUES (?, 't', ?, 'called', ?, 'sent', ?, ?)",
      )
        .bind(id, to, sentAt, sentAt, sentAt)
        .run();
    await ticket(ids[0], dead, now - 20 * MIN);
    await ticket(ids[1], alive, now - 20 * MIN);
    await ticket(ids[2], dead, now - 5 * MIN); // too recent: not checked
    push.receipts[ids[0]] = {
      status: "error",
      details: { error: "DeviceNotRegistered" },
    };
    push.receipts[ids[1]] = { status: "ok" };
    push.receipts[ids[2]] = {
      status: "error",
      details: { error: "DeviceNotRegistered" },
    };

    await runScheduled(CRON_HOURLY, env, now);

    const statuses = await env.DB.prepare(
      `SELECT id, status, receipt_checked_at IS NOT NULL AS checked FROM push_tickets WHERE id IN (?, ?, ?)`,
    )
      .bind(...ids)
      .all<{ id: string; status: string; checked: number }>();
    const byId = Object.fromEntries(
      statuses.results.map((r) => [r.id, [r.status, r.checked]]),
    );
    expect(byId[ids[0]]).toEqual(["DeviceNotRegistered", 1]);
    expect(byId[ids[1]]).toEqual(["ok", 1]);
    expect(byId[ids[2]]).toEqual(["sent", 0]);
    const left = await env.DB.prepare(
      "SELECT expo_push_token FROM devices WHERE expo_push_token IN (?, ?)",
    )
      .bind(dead, alive)
      .all<{ expo_push_token: string }>();
    expect(left.results.map((r) => r.expo_push_token)).toEqual([alive]);
  });
});

describe("cron dispatch on one trigger (INC-056)", () => {
  it("runs hourly jobs at minute 0 and daily jobs at 21:30 UTC", () => {
    const at = (iso: string) => Date.parse(iso);
    expect(dueSchedules(CRON_QUARTER_HOUR, at("2026-10-29T10:15:00Z"))).toEqual(
      [CRON_QUARTER_HOUR],
    );
    expect(dueSchedules(CRON_QUARTER_HOUR, at("2026-10-29T10:00:00Z"))).toEqual(
      [CRON_QUARTER_HOUR, CRON_HOURLY],
    );
    expect(dueSchedules(CRON_QUARTER_HOUR, at("2026-10-29T21:30:00Z"))).toEqual(
      [CRON_QUARTER_HOUR, CRON_DAILY],
    );
    expect(dueSchedules(CRON_HOURLY, at("2026-10-29T10:15:00Z"))).toEqual([
      CRON_HOURLY,
    ]);
  });
});
