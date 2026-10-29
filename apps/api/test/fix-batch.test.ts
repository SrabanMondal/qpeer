import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  autoCloseAt,
  BusinessView,
  ConsoleState,
  defaultWeeklyHours,
  KEEP_OPEN_STEP_MS,
  MyTokensResponse,
  QueueInfoResponse,
  QueueView,
  TicketKeysResponse,
  TokenView,
  verifyTicket,
  type WeeklyHours,
} from "@qpeer/shared";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CRON_QUARTER_HOUR, runScheduled } from "../src/cron/jobs";
import { pushOverride } from "../src/modules/notifications/expo-push";
import type { QueueDO } from "../src/queue/queue-do";
import { expectError, expectOk, makeTestApi } from "./helpers";
import {
  fakePush,
  JAMMU,
  MIN,
  must,
  mustFail,
  seedQueue,
} from "./queue-helpers";

type Stub = Awaited<ReturnType<typeof seedQueue>>["stub"];

let push: ReturnType<typeof fakePush>;
beforeAll(() => {
  push = fakePush();
  pushOverride.transport = push.transport;
});
afterEach(() => {
  push.sent.length = 0;
});

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const NO_HOURS: WeeklyHours = {
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};

async function join(
  stub: Stub,
  userId: string | null = crypto.randomUUID(),
  deviceHash?: string,
) {
  return TokenView.parse(
    must(
      await stub.allocate({
        method: "walkin",
        userId,
        cls: "regular",
        deviceHash,
      }),
    ).token,
  );
}

async function view(stub: Stub, id: string) {
  return TokenView.parse(must(await stub.getToken(id)).token);
}

async function consoleOf(stub: Stub) {
  return ConsoleState.parse(await stub.getState());
}

async function openedAt(stub: Stub): Promise<number> {
  return runInDurableObject(stub, (_i: QueueDO, state) => {
    const row = state.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'opened_at'")
      .one();
    return Number(JSON.parse(row.value));
  });
}

// ---------------------------------------------------------------------------

describe("Now serving (coordinator report 2026-10-16)", () => {
  it("a called token that leaves stops showing; the last served shows instead", async () => {
    const { stub } = await seedQueue();
    const a = await join(stub);
    const b = await join(stub);
    const c = await join(stub);
    must(await stub.next(1)); // #1 called
    must(await stub.next(1)); // #1 served, #2 called
    expect((await consoleOf(stub)).nowServing).toBe("2");
    must(await stub.leave(b.id, null)); // #2 leaves while CALLED
    const after = await consoleOf(stub);
    expect(after.nowServing).toBe("1");
    expect((await view(stub, c.id)).nowServing).toBe("1");
    expect(a.number).toBe(1);
  });

  it("nothing served yet: a skipped or no-show called token leaves it empty", async () => {
    const { stub } = await seedQueue();
    const a = await join(stub);
    await join(stub);
    must(await stub.next(1));
    expect((await consoleOf(stub)).nowServing).toBe("1");
    must(await stub.noShow(a.id));
    expect((await consoleOf(stub)).nowServing).toBeNull();
    must(await stub.admit(a.id));
    expect((await consoleOf(stub)).nowServing).toBe("1");
    must(await stub.skip(a.id));
    expect((await consoleOf(stub)).nowServing).toBeNull();
  });

  it("the snapshot in D1 follows the same rule", async () => {
    const { stub, queueId } = await seedQueue();
    const a = await join(stub);
    must(await stub.next(1));
    must(await stub.leave(a.id, null));
    await stub.flushOutbox();
    const row = await env.DB.prepare(
      "SELECT now_serving, in_service FROM queue_snapshots WHERE queue_id = ?",
    )
      .bind(queueId)
      .first();
    expect(row).toEqual({ now_serving: null, in_service: 0 });
  });

  it("undo of Next restores the previous now serving", async () => {
    const { stub } = await seedQueue();
    await join(stub);
    await join(stub);
    must(await stub.next(1));
    must(await stub.next(1));
    expect((await consoleOf(stub)).nowServing).toBe("2");
    must(await stub.undoNext());
    expect((await consoleOf(stub)).nowServing).toBe("1");
  });
});

describe("Live summary inService (B19)", () => {
  it("counts tokens at a counter", async () => {
    const { stub } = await seedQueue();
    await join(stub);
    expect((await stub.getSummary()).inService).toBe(0);
    must(await stub.next(1));
    const s = await stub.getSummary();
    expect(s.inService).toBe(1);
    expect(s.waiting).toBe(0);
  });
});

describe("Device hash (C2, INC-042)", () => {
  it("a second account on the same phone gets device_in_queue; the same account gets already_in_queue", async () => {
    const { stub } = await seedQueue();
    const user = crypto.randomUUID();
    const first = await join(stub, user, HASH_A);
    const same = mustFail(
      await stub.allocate({
        method: "walkin",
        userId: user,
        cls: "regular",
        deviceHash: HASH_A,
      }),
      "already_in_queue",
    );
    expect(!same.ok && same.details?.tokenId).toBe(first.id);
    const other = mustFail(
      await stub.allocate({
        method: "walkin",
        userId: crypto.randomUUID(),
        cls: "regular",
        deviceHash: HASH_A,
      }),
      "device_in_queue",
    );
    expect(!other.ok && other.details).toBeUndefined();
    // Another phone, or an old build without a hash: fine.
    await join(stub, crypto.randomUUID(), HASH_B);
    await join(stub, crypto.randomUUID());
    // After leaving, the phone may join again.
    must(await stub.leave(first.id, null));
    await join(stub, crypto.randomUUID(), HASH_A);
  });

  it("paid allocations ignore the device rule", async () => {
    const { stub } = await seedQueue();
    await join(stub, crypto.randomUUID(), HASH_A);
    must(
      await stub.allocate({
        method: "remote",
        userId: crypto.randomUUID(),
        cls: "regular",
        paymentOrderId: crypto.randomUUID(),
        deviceHash: HASH_A,
      }),
    );
  });

  it("the hash lands on the D1 token row and on the strike", async () => {
    const { stub } = await seedQueue({ settings: { graceMinutes: 1 } });
    const t = await join(stub, crypto.randomUUID(), HASH_B);
    must(await stub.next(1));
    must(await stub.noShow(t.id));
    await stub.testAdvanceClock(MIN + 1000);
    await runDurableObjectAlarm(stub); // → MISSED
    must(await stub.close()); // never rejoined → EXPIRED + strike (QUE-24)
    await stub.flushOutbox();
    const tok = await env.DB.prepare(
      "SELECT device_hash FROM tokens WHERE id = ?",
    )
      .bind(t.id)
      .first();
    expect(tok).toEqual({ device_hash: HASH_B });
    const strike = await env.DB.prepare(
      "SELECT device_hash FROM free_lane_strikes WHERE token_id = ?",
    )
      .bind(t.id)
      .first();
    expect(strike).toEqual({ device_hash: HASH_B });
  });
});

describe("Ticket validity and carry-over (C4)", () => {
  it("a token expires by time as EXPIRED/validity through the alarm", async () => {
    const { stub } = await seedQueue({ settings: { ticketValidityMin: 60 } });
    const t = await join(stub);
    expect(t.expiresAt).toBe(t.joinedAt + 60 * MIN);
    await stub.testAdvanceClock(60 * MIN + 1000);
    await runDurableObjectAlarm(stub);
    const v = await view(stub, t.id);
    expect(v.state).toBe("EXPIRED");
    expect(v.endReason).toBe("validity");
  });

  it("until-close tokens (default) have no expiry and end on close", async () => {
    const { stub } = await seedQueue();
    const t = await join(stub);
    expect(t.expiresAt).toBeNull();
    must(await stub.close());
    expect((await view(stub, t.id)).endReason).toBe("closed");
  });

  it("on close, still-valid WAITING tokens carry over to the front of the next session in order, keeping their numbers", async () => {
    const { stub } = await seedQueue({ settings: { ticketValidityMin: 1440 } });
    const a = await join(stub);
    const b = await join(stub);
    const c = await join(stub);
    must(await stub.next(1)); // a CALLED → ends on close
    const closed = must(await stub.close());
    expect(closed.console.status).toBe("closed");
    expect((await view(stub, a.id)).endReason).toBe("closed");
    for (const t of [b, c]) {
      const v = await view(stub, t.id);
      expect(v.state).toBe("WAITING");
      expect(v.carriedOver).toBe(true);
      expect(v.queueStatus).toBe("closed");
    }
    // While closed they are listed in the console.
    expect((await consoleOf(stub)).waiting.map((t) => t.label)).toEqual([
      "2",
      "3",
    ]);

    must(await stub.open());
    const fresh = await join(stub);
    expect(fresh.number).toBe(1); // new session numbering
    const con = await consoleOf(stub);
    expect(con.waiting.map((t) => [t.label, t.carriedOver])).toEqual([
      ["2", true],
      ["3", true],
      ["1", false],
    ]);
    expect((await view(stub, b.id)).peopleAhead).toBe(0);
    expect((await view(stub, fresh.id)).peopleAhead).toBe(2);
    must(await stub.next(1));
    expect((await consoleOf(stub)).nowServing).toBe("2");
  });

  it("a carried token whose validity runs out while closed expires", async () => {
    const { stub } = await seedQueue({ settings: { ticketValidityMin: 120 } });
    const t = await join(stub);
    must(await stub.close());
    expect((await view(stub, t.id)).carriedOver).toBe(true);
    await stub.testAdvanceClock(121 * MIN);
    await runDurableObjectAlarm(stub);
    const v = await view(stub, t.id);
    expect(v.state).toBe("EXPIRED");
    expect(v.endReason).toBe("validity");
  });

  it("a carried token's overnight wait is not counted in the wait analytics", async () => {
    const { stub, queueId } = await seedQueue({
      settings: { ticketValidityMin: 1440 },
    });
    await join(stub);
    must(await stub.close());
    await stub.testAdvanceClock(10 * 60 * MIN);
    must(await stub.open());
    must(await stub.next(1));
    must(await stub.close());
    await stub.flushOutbox();
    const r = await env.DB.prepare(
      "SELECT COALESCE(SUM(waits), 0) AS waits, COALESCE(SUM(joins), 0) AS joins FROM analytics_hourly WHERE queue_id = ?",
    )
      .bind(queueId)
      .first<{ waits: number; joins: number }>();
    expect(r).toEqual({ waits: 0, joins: 1 });
  });
});

describe("Auto-close (B20, INC-047)", () => {
  it("the alarm closes the session at autoCloseAt; tokens end as on a manual close", async () => {
    const { stub } = await seedQueue();
    await stub.setHours(NO_HOURS);
    const t = await join(stub);
    const opened = await openedAt(stub);
    const due = autoCloseAt(NO_HOURS, opened);
    const con = await consoleOf(stub);
    expect(con.autoCloseAt).toBe(due);
    const now = Date.now();
    await stub.testAdvanceClock(due - now + 1000);
    await runDurableObjectAlarm(stub);
    expect((await consoleOf(stub)).status).toBe("closed");
    const v = await view(stub, t.id);
    expect(v.state).toBe("EXPIRED");
    expect(v.endReason).toBe("closed");
    expect((await consoleOf(stub)).autoCloseAt).toBeNull();
  });

  it("Keep open moves the auto-close 1 h later per tap", async () => {
    const { stub } = await seedQueue();
    await stub.setHours(NO_HOURS);
    const before = (await consoleOf(stub)).autoCloseAt as number;
    const once = must(await stub.keepOpen());
    expect(once.autoCloseAt).toBe(before + KEEP_OPEN_STEP_MS);
    const twice = must(await stub.keepOpen());
    expect(twice.autoCloseAt).toBe(before + 2 * KEEP_OPEN_STEP_MS);
    // Past the original time: still open.
    await stub.testAdvanceClock(before - Date.now() + MIN);
    await runDurableObjectAlarm(stub);
    expect((await consoleOf(stub)).status).toBe("open");
    // Past the extended time: closed.
    await stub.testAdvanceClock(2 * KEEP_OPEN_STEP_MS);
    await runDurableObjectAlarm(stub);
    expect((await consoleOf(stub)).status).toBe("closed");
    mustFail(await stub.keepOpen(), "invalid_state");
  });

  it("carry-over applies on the auto-close too", async () => {
    const { stub } = await seedQueue({ settings: { ticketValidityMin: 2880 } });
    await stub.setHours(NO_HOURS);
    const t = await join(stub);
    const due = (await consoleOf(stub)).autoCloseAt as number;
    await stub.testAdvanceClock(due - Date.now() + 1000);
    await runDurableObjectAlarm(stub);
    expect((await consoleOf(stub)).status).toBe("closed");
    expect((await view(stub, t.id)).carriedOver).toBe(true);
  });

  it("the 15-minute cron gives the DO its hours and closes an overdue session", async () => {
    // No hours in the DO: only the cron can close it (like a session opened
    // before this code was deployed).
    const { stub, queueId } = await seedQueue();
    const t = await join(stub);
    expect((await consoleOf(stub)).autoCloseAt).toBeNull();
    await stub.flushOutbox();
    // Put this queue first in the cron's stalest-first order.
    await env.DB.prepare(
      "UPDATE queue_snapshots SET updated_at = 0 WHERE queue_id = ?",
    )
      .bind(queueId)
      .run();
    // Move the DO's clock 3 days on: whatever the hours, it is overdue.
    await stub.testAdvanceClock(3 * 24 * 60 * MIN);
    const res = await runScheduled(CRON_QUARTER_HOUR, env, Date.now());
    expect(res.auto_close).toMatchObject({ failed: 0 });
    expect((res.auto_close as { closed: number }).closed).toBeGreaterThan(0);
    expect((await consoleOf(stub)).status).toBe("closed");
    expect((await view(stub, t.id)).endReason).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// Through the API: join with a device hash, signed tickets, queue info.

async function ticketKey(): Promise<{ jwk: string; kid: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey(
    "jwk",
    pair.privateKey,
  )) as JsonWebKey;
  const kid = `test-${crypto.randomUUID().slice(0, 8)}`;
  return { jwk: JSON.stringify({ ...jwk, kid }), kid };
}

describe("API: device hash, signed tickets, queue info", () => {
  let api: Awaited<ReturnType<typeof makeTestApi>>;
  let plain: Awaited<ReturnType<typeof makeTestApi>>;
  let kid: string;
  let owner: string;
  const NEAR = { lat: JAMMU.lat, lng: JAMMU.lng, accuracyM: 20, mocked: false };

  beforeAll(async () => {
    const key = await ticketKey();
    kid = key.kid;
    api = await makeTestApi({ env: { TICKET_SIGNING_KEY: key.jwk } });
    plain = await makeTestApi();
    owner = await api.token({ sub: "fb-owner" });
  });

  async function setup(settings?: Record<string, number>) {
    const biz = await expectOk(
      await api.call("POST", "/v1/businesses", owner, {
        name: "Fix Clinic",
        category: "clinic",
        location: JAMMU,
      }),
      201,
      BusinessView,
    );
    const queue = await expectOk(
      await api.call("POST", `/v1/businesses/${biz.id}/queues`, owner, {
        name: "OPD",
        ...(settings ? { settings } : {}),
      }),
      201,
      QueueView,
    );
    await expectOk(
      await api.call("POST", `/v1/queues/${queue.id}/open`, owner),
      200,
      ConsoleState,
    );
    return queue.id;
  }

  it("C2: second anonymous account on the same phone → 409 device_in_queue; the same account → already_in_queue with its tokenId", async () => {
    const q = await setup();
    const first = await api.token({ sub: "fb-dev-1", anonymous: true });
    const second = await api.token({ sub: "fb-dev-2", anonymous: true });
    const body = { ...NEAR, deviceHash: HASH_A };
    const t = await expectOk(
      await api.call("POST", `/v1/queues/${q}/join`, first, body),
      201,
      TokenView,
    );
    const again = await expectError(
      await api.call("POST", `/v1/queues/${q}/join`, first, body),
      409,
      "already_in_queue",
    );
    expect(again.details).toEqual({ tokenId: t.id });
    const dev = await expectError(
      await api.call("POST", `/v1/queues/${q}/join`, second, body),
      409,
      "device_in_queue",
    );
    expect(dev.details).toBeUndefined();
    // Without a hash (old build) the second account can still join.
    await expectOk(
      await api.call("POST", `/v1/queues/${q}/join`, second, NEAR),
      201,
      TokenView,
    );
    // A bad hash is invalid input, never stored.
    await expectError(
      await api.call("POST", `/v1/queues/${q}/join`, second, {
        ...NEAR,
        deviceHash: "not-a-hash",
      }),
      400,
      "invalid_input",
    );
  });

  it("C2: 3 no-shows on a phone within 30 days block free joins from any account on it", async () => {
    const q = await setup();
    const now = api.clock.now();
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare(
        "INSERT INTO free_lane_strikes (id, user_id, token_id, at, created_at, device_hash) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(
          crypto.randomUUID(),
          `old-${i}`,
          `t-${i}`,
          now - i * MIN,
          now,
          HASH_C,
        )
        .run();
    }
    const fresh = await api.token({ sub: "fb-dev-fresh", anonymous: true });
    const err = await expectError(
      await api.call("POST", `/v1/queues/${q}/join`, fresh, {
        ...NEAR,
        deviceHash: HASH_C,
      }),
      423,
      "free_lane_blocked",
    );
    expect((err.details as { until: number }).until).toBe(
      now + 7 * 24 * 60 * MIN,
    );
  });

  it("C3: join and GET return a signed ticket that verifies with /v1/ticket-keys; ended tokens have none", async () => {
    const q = await setup({ ticketValidityMin: 240 });
    const cust = await api.token({ sub: "fb-ticket", anonymous: true });
    const t = await expectOk(
      await api.call("POST", `/v1/queues/${q}/join`, cust, NEAR),
      201,
      TokenView,
    );
    expect(t.signedTicket).toBeTruthy();
    const keysRes = await api.call("GET", "/v1/ticket-keys", null);
    expect(keysRes.headers.get("cache-control")).toMatch(/max-age/);
    const keys = await expectOk(keysRes, 200, TicketKeysResponse);
    expect(keys.keys.map((k) => k.kid)).toEqual([kid]);
    expect(JSON.stringify(keys)).not.toMatch(/"d"/);
    const check = verifyTicket(t.signedTicket as string, keys.keys, {
      now: t.joinedAt + MIN,
      queueId: q,
    });
    expect(check.status).toBe("valid");
    if (check.status === "valid") {
      expect(check.payload).toMatchObject({
        t: t.id,
        n: t.number,
        s: "R",
        c: "regular",
        exp: t.joinedAt + 240 * MIN,
        kid,
      });
    }
    // GET signs the same ticket (iat = join time, Ed25519 is deterministic).
    const got = await expectOk(
      await api.call("GET", `/v1/tokens/${t.id}`, cust),
      200,
      TokenView,
    );
    expect(got.signedTicket).toBe(t.signedTicket);
    expect(
      verifyTicket(t.signedTicket as string, keys.keys, {
        now: t.joinedAt + MIN,
        queueId: crypto.randomUUID(),
      }).status,
    ).toBe("other_queue");
    // Leave → no ticket on the answer.
    const left = await expectOk(
      await api.call("POST", `/v1/tokens/${t.id}/leave`, cust),
      200,
      TokenView,
    );
    expect(left.signedTicket ?? null).toBeNull();
    const after = await expectOk(
      await api.call("GET", `/v1/tokens/${t.id}`, cust),
      200,
      TokenView,
    );
    expect(after.signedTicket).toBeNull();
    // My tokens carries expiresAt.
    const mine = await expectOk(
      await api.call("GET", "/v1/me/tokens?status=recent", cust),
      200,
      MyTokensResponse,
    );
    expect(mine.items[0].expiresAt).toBe(t.joinedAt + 240 * MIN);
  });

  it("C3: without TICKET_SIGNING_KEY nothing is signed and the key list is empty", async () => {
    const tok = await plain.token({ sub: "fb-plain-owner" });
    const biz = await expectOk(
      await plain.call("POST", "/v1/businesses", tok, {
        name: "Plain",
        category: "clinic",
        location: JAMMU,
      }),
      201,
      BusinessView,
    );
    const queue = await expectOk(
      await plain.call("POST", `/v1/businesses/${biz.id}/queues`, tok, {
        name: "OPD",
      }),
      201,
      QueueView,
    );
    await plain.call("POST", `/v1/queues/${queue.id}/open`, tok);
    const cust = await plain.token({ sub: "fb-plain-cust", anonymous: true });
    const t = await expectOk(
      await plain.call("POST", `/v1/queues/${queue.id}/join`, cust, NEAR),
      201,
      TokenView,
    );
    expect(t.signedTicket).toBeNull();
    const keys = await expectOk(
      await plain.call("GET", "/v1/ticket-keys", null),
      200,
      TicketKeysResponse,
    );
    expect(keys.keys).toEqual([]);
  });

  it("B16: queue info tells the join screen whether it is inside the hours", async () => {
    const q = await setup();
    const info = await expectOk(
      await api.call("GET", `/v1/queues/${q}`, owner),
      200,
      QueueInfoResponse,
    );
    expect(typeof info.business.isOpenNow).toBe("boolean");
    expect(info.business.todayHours?.text).toBeTruthy();
    expect(info.live.inService).toBe(0);
  });

  it("B20: keep-open route for staff; the console carries autoCloseAt", async () => {
    const q = await setup();
    const con = await expectOk(
      await api.call("GET", `/v1/queues/${q}/console`, owner),
      200,
      ConsoleState,
    );
    expect(con.autoCloseAt).toEqual(expect.any(Number));
    const kept = await expectOk(
      await api.call("POST", `/v1/queues/${q}/keep-open`, owner),
      200,
      ConsoleState,
    );
    expect(kept.autoCloseAt).toBe(
      (con.autoCloseAt as number) + KEEP_OPEN_STEP_MS,
    );
    const stranger = await api.token({ sub: "fb-stranger" });
    await expectError(
      await api.call("POST", `/v1/queues/${q}/keep-open`, stranger),
      404,
      "not_found",
    );
  });

  it("B20: changing the hours updates the auto-close of open queues", async () => {
    const q = await setup();
    const info = await expectOk(
      await api.call("GET", `/v1/queues/${q}`, owner),
      200,
      QueueInfoResponse,
    );
    const before = await expectOk(
      await api.call("GET", `/v1/queues/${q}/console`, owner),
      200,
      ConsoleState,
    );
    const all: WeeklyHours = {
      ...defaultWeeklyHours(),
      mon: [{ from: "00:00", to: "23:59" }],
      tue: [{ from: "00:00", to: "23:59" }],
      wed: [{ from: "00:00", to: "23:59" }],
      thu: [{ from: "00:00", to: "23:59" }],
      fri: [{ from: "00:00", to: "23:59" }],
      sat: [{ from: "00:00", to: "23:59" }],
      sun: [{ from: "00:00", to: "23:59" }],
    };
    await expectOk(
      await api.call("PATCH", `/v1/businesses/${info.business.id}`, owner, {
        hours: all,
      }),
      200,
      BusinessView,
    );
    const after = await expectOk(
      await api.call("GET", `/v1/queues/${q}/console`, owner),
      200,
      ConsoleState,
    );
    // 23:59 + 30 min of the opening day: later than or equal to before.
    expect(after.autoCloseAt as number).toBeGreaterThanOrEqual(
      before.autoCloseAt as number,
    );
    expect(after.autoCloseAt).not.toBeNull();
  });
});
