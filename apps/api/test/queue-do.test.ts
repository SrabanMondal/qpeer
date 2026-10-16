import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { ConsoleState, TokenView } from "@qpeer/shared";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { pushOverride } from "../src/modules/notifications/expo-push";
import { SKIP_BEHIND } from "../src/queue/ordering";
import { outboxFaults } from "../src/queue/outbox";
import type { QueueDO } from "../src/queue/queue-do";
import { earliestDue } from "../src/queue/scheduler";
import {
  addDevice,
  collect,
  fakePush,
  MIN,
  must,
  mustFail,
  seedQueue,
  stubFor,
  waitFor,
} from "./queue-helpers";

let push: ReturnType<typeof fakePush>;

beforeAll(() => {
  push = fakePush();
  pushOverride.transport = push.transport;
});

afterEach(() => {
  outboxFaults.failD1 = 0;
});

type Stub = Awaited<ReturnType<typeof seedQueue>>["stub"];

async function join(stub: Stub, userId: string | null = crypto.randomUUID()) {
  const r = must(
    await stub.allocate({ method: "walkin", userId, cls: "regular" }),
  );
  return TokenView.parse(r.token);
}

async function view(stub: Stub, id: string) {
  return TokenView.parse(must(await stub.getToken(id)).token);
}

async function consoleOf(stub: Stub) {
  return ConsoleState.parse(await stub.getState());
}

const waitingLabels = (c: ConsoleState) => c.waiting.map((t) => t.label);

describe("QueueDO numbering and order", () => {
  it("QUE-01: parallel joins get unique, consecutive numbers", async () => {
    const { stub } = await seedQueue();
    const tokens = await Promise.all(
      Array.from({ length: 40 }, () => join(stub)),
    );
    const numbers = tokens.map((t) => t.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(new Set(tokens.map((t) => t.id)).size).toBe(40);
  });

  it("QUE-02/QUE-11: triage goes ahead of regular tokens; regulars keep join order", async () => {
    const { stub } = await seedQueue();
    const a = await join(stub);
    const b = await join(stub);
    const t = must(await stub.insertTriage());
    expect(t.token.series).toBe("T");
    expect(t.token.label).toBe("T1");
    expect(t.token.peopleAhead).toBe(0);
    expect(waitingLabels(await consoleOf(stub))).toEqual(["T1", "1", "2"]);
    expect((await view(stub, a.id)).peopleAhead).toBe(1);
    expect((await view(stub, b.id)).peopleAhead).toBe(2);
  });

  it("QUE-03: people ahead stays exact after leave, skip, no-show and triage", async () => {
    const { stub } = await seedQueue();
    const users = Array.from({ length: 6 }, () => crypto.randomUUID());
    const t = [];
    for (const u of users) t.push(await join(stub, u));
    expect((await view(stub, t[5].id)).peopleAhead).toBe(5);

    must(await stub.leave(t[1].id, users[1]));
    expect((await view(stub, t[5].id)).peopleAhead).toBe(4);

    must(await stub.next(1)); // calls #1
    expect((await view(stub, t[5].id)).peopleAhead).toBe(3);
    must(await stub.noShow(t[0].id)); // #1 → grace (not waiting)
    expect((await view(stub, t[5].id)).peopleAhead).toBe(3);

    must(await stub.skip(t[2].id)); // #3 behind #4, #5, #6 → end
    expect((await view(stub, t[5].id)).peopleAhead).toBe(2);
    expect((await view(stub, t[2].id)).peopleAhead).toBe(3);

    must(await stub.insertTriage());
    expect((await view(stub, t[5].id)).peopleAhead).toBe(3);
  });

  it(`QUE-06: skip puts the token behind the next ${SKIP_BEHIND} waiting tokens, or at the end`, async () => {
    const { stub } = await seedQueue();
    const t = [];
    for (let i = 0; i < 7; i++) t.push(await join(stub));
    must(await stub.skip(t[0].id));
    expect(waitingLabels(await consoleOf(stub))).toEqual([
      "2",
      "3",
      "4",
      "1",
      "5",
      "6",
      "7",
    ]);
    // Repeated skips into the same gap stay correct (renumbering kicks in).
    for (let i = 0; i < 12; i++) must(await stub.skip(t[1].id));
    const c = await consoleOf(stub);
    expect(new Set(c.waiting.map((w) => w.id)).size).toBe(7);
    // Fewer than 3 behind → to the end.
    const last = c.waiting[c.waiting.length - 2];
    must(await stub.skip(last.id));
    const after = await consoleOf(stub);
    expect(after.waiting[after.waiting.length - 1].id).toBe(last.id);
    // A called token can be skipped back into the waiting list.
    must(await stub.next(1));
    const called = (await consoleOf(stub)).serving[0];
    must(await stub.skip(called.id));
    const back = await consoleOf(stub);
    expect(back.serving).toHaveLength(0);
    expect(back.waiting.findIndex((w) => w.id === called.id)).toBe(SKIP_BEHIND);
  });

  it("QUE-04: one active free token per user per queue", async () => {
    const { stub } = await seedQueue();
    const user = crypto.randomUUID();
    const first = await join(stub, user);
    const r = mustFail(
      await stub.allocate({ method: "walkin", userId: user, cls: "regular" }),
      "already_in_queue",
    );
    if (!r.ok) expect(r.details).toEqual({ tokenId: first.id });
    must(await stub.leave(first.id, user));
    await join(stub, user);
  });

  it("queue_full when the waiting list reaches maxSize", async () => {
    const { stub } = await seedQueue({ settings: { maxSize: 10 } });
    for (let i = 0; i < 10; i++) await join(stub);
    mustFail(await stub.checkJoin(), "queue_full");
    mustFail(
      await stub.allocate({
        method: "walkin",
        userId: crypto.randomUUID(),
        cls: "regular",
      }),
      "queue_full",
    );
  });
});

describe("QueueDO operations", () => {
  it("QUE-05: Next calls the head with the counter, serves the previous one and sets now serving", async () => {
    const { stub } = await seedQueue({ settings: { counters: 2 } });
    const a = await join(stub);
    const b = await join(stub);
    let c = ConsoleState.parse(must(await stub.next(2)));
    expect(c.serving.map((t) => [t.label, t.counter])).toEqual([["1", 2]]);
    expect(c.nowServing).toBe("1");
    const va = await view(stub, a.id);
    expect(va.state).toBe("CALLED");
    expect(va.counter).toBe(2);
    expect(va.calledAt).not.toBeNull();

    await stub.testAdvanceClock(3 * MIN);
    c = ConsoleState.parse(must(await stub.next(2)));
    expect((await view(stub, a.id)).state).toBe("SERVED");
    expect((await view(stub, b.id)).state).toBe("CALLED");
    expect(c.nowServing).toBe("2");
    expect(c.eta.intervals).toBe(1);

    mustFail(await stub.next(3), "invalid_state"); // no such counter
    must(await stub.next(2)); // serves #2, nobody left to call
    mustFail(await stub.next(2), "invalid_state");
  });

  it("QUE-07: pause blocks joins and Next; paused time is excluded from the interval", async () => {
    const { stub } = await seedQueue();
    for (let i = 0; i < 3; i++) await join(stub);
    must(await stub.next(1));
    await stub.testAdvanceClock(2 * MIN);
    must(await stub.pause());
    mustFail(await stub.checkJoin(), "queue_paused");
    mustFail(await stub.next(1), "queue_paused");
    const waiting = (await consoleOf(stub)).waiting[0];
    expect((await view(stub, waiting.id)).queueStatus).toBe("paused");
    await stub.testAdvanceClock(20 * MIN);
    must(await stub.resume());
    await stub.testAdvanceClock(1 * MIN);
    must(await stub.next(1));
    const intervals = await runInDurableObject(stub, (_i: QueueDO, state) =>
      state.storage.sql
        .exec<{ ms: number }>("SELECT ms FROM intervals")
        .toArray()
        .map((r) => r.ms),
    );
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toBeGreaterThanOrEqual(3 * MIN);
    expect(intervals[0]).toBeLessThan(3 * MIN + 2000);
  });

  it("QUE-08: no-show → grace → admit as the one being served", async () => {
    const { stub } = await seedQueue({ settings: { graceMinutes: 10 } });
    const a = await join(stub);
    await join(stub);
    must(await stub.next(1));
    const c = ConsoleState.parse(must(await stub.noShow(a.id)));
    expect(c.grace.map((t) => t.id)).toEqual([a.id]);
    const g = await view(stub, a.id);
    expect(g.state).toBe("GRACE");
    expect(g.graceUntil).toBeGreaterThan(Date.now() + 9 * MIN);
    mustFail(await stub.admit(crypto.randomUUID()), "not_found");
    must(await stub.admit(a.id));
    const back = await view(stub, a.id);
    expect(back.state).toBe("CALLED");
    expect(back.graceUntil).toBeNull();
    must(await stub.served(a.id));
    expect((await view(stub, a.id)).state).toBe("SERVED");
  });

  it("QUE-08/JON-07: grace expiry via the alarm → EXPIRED no-show and a free-lane strike in D1", async () => {
    const { stub } = await seedQueue({ settings: { graceMinutes: 1 } });
    const user = crypto.randomUUID();
    const a = await join(stub, user);
    must(await stub.next(1));
    must(await stub.noShow(a.id));
    await stub.testAdvanceClock(1 * MIN + 1000);
    await runDurableObjectAlarm(stub);
    const v = await view(stub, a.id);
    expect(v.state).toBe("EXPIRED");
    expect(v.endReason).toBe("no_show");
    const strikes = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM free_lane_strikes WHERE user_id = ? AND token_id = ?",
    )
      .bind(user, a.id)
      .first<{ n: number }>();
    expect(strikes?.n).toBe(1);
    const d1 = await env.DB.prepare(
      "SELECT state, end_reason FROM tokens WHERE id = ?",
    )
      .bind(a.id)
      .first();
    expect(d1).toEqual({ state: "EXPIRED", end_reason: "no_show" });
  });

  it("JON-07: the third no-show within 30 days sets users.free_lane_blocked_until", async () => {
    const { stub } = await seedQueue({ settings: { graceMinutes: 1 } });
    const userId = crypto.randomUUID();
    const t0 = Date.now();
    await env.DB.prepare(
      "INSERT INTO users (id, firebase_uid, is_anonymous, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
    )
      .bind(userId, `fb-${userId}`, t0, t0)
      .run();
    for (let i = 0; i < 3; i++) {
      const tok = await join(stub, userId);
      must(await stub.next(1));
      must(await stub.noShow(tok.id));
      await stub.testAdvanceClock(MIN + 1000);
      await runDurableObjectAlarm(stub);
      expect((await view(stub, tok.id)).state).toBe("EXPIRED");
      const u = await env.DB.prepare(
        "SELECT free_lane_blocked_until AS until FROM users WHERE id = ?",
      )
        .bind(userId)
        .first<{ until: number | null }>();
      if (i < 2) expect(u?.until).toBeNull();
      else expect(u?.until).toBeGreaterThan(Date.now() + 6 * 24 * 60 * MIN);
    }
  });

  it("QUE-09: close expires every active token and rejects joins", async () => {
    const { stub } = await seedQueue();
    const a = await join(stub);
    const b = await join(stub);
    must(await stub.next(1));
    const r = must(await stub.close());
    expect(r.paidTokens).toEqual([]);
    expect(r.console.status).toBe("closed");
    expect(r.console.counts.total).toBe(0);
    for (const id of [a.id, b.id]) {
      const v = await view(stub, id);
      expect(v.state).toBe("EXPIRED");
      expect(v.endReason).toBe("closed");
    }
    mustFail(await stub.checkJoin(), "queue_closed");
    // a new session restarts numbering
    must(await stub.open());
    expect((await join(stub)).number).toBe(1);
  });

  it("QUE-10: leave by the owner only; cancel of a free token = leave", async () => {
    const { stub } = await seedQueue();
    const user = crypto.randomUUID();
    const a = await join(stub, user);
    mustFail(await stub.leave(a.id, crypto.randomUUID()), "not_found");
    const left = TokenView.parse(must(await stub.leave(a.id, user)));
    expect(left.state).toBe("LEFT");
    must(await stub.leave(a.id, user)); // idempotent
    const b = await join(stub, user);
    const c = must(await stub.cancel(b.id, user));
    expect(c.token.state).toBe("LEFT");
    expect(c.refund).toBe(false);
  });

  it("QUE-11: triage has a daily cap", async () => {
    const { stub } = await seedQueue({ settings: { triageDailyCap: 2 } });
    must(await stub.insertTriage());
    const second = must(await stub.insertTriage());
    expect(second.console.triageLeftToday).toBe(0);
    mustFail(await stub.insertTriage(), "quota_full");
  });

  it("QUE-12: undo the last Next within 30 s; rejected after", async () => {
    const { stub } = await seedQueue();
    const a = await join(stub);
    const b = await join(stub);
    must(await stub.next(1)); // calls a
    await stub.testAdvanceClock(2 * MIN);
    const c = ConsoleState.parse(must(await stub.next(1))); // serves a, calls b
    expect(c.undoUntil).not.toBeNull();
    expect(c.eta.intervals).toBe(1);
    await stub.testAdvanceClock(10_000);
    const u = ConsoleState.parse(must(await stub.undoNext()));
    expect((await view(stub, b.id)).state).toBe("WAITING");
    expect((await view(stub, b.id)).peopleAhead).toBe(0);
    expect((await view(stub, a.id)).state).toBe("CALLED");
    expect(u.nowServing).toBe("1");
    expect(u.eta.intervals).toBe(0);
    mustFail(await stub.undoNext(), "invalid_state"); // only once

    must(await stub.next(1));
    await stub.testAdvanceClock(31_000);
    mustFail(await stub.undoNext(), "invalid_state");
  });
});

describe("QueueDO wait estimate", () => {
  it("QUE-13: cold start uses serviceMinutesHint, then the EWMA of real intervals", async () => {
    const { stub } = await seedQueue({ settings: { serviceMinutesHint: 6 } });
    for (let i = 0; i < 6; i++) await join(stub);
    let c = await consoleOf(stub);
    expect(c.eta.coldStart).toBe(true);
    expect(c.eta.meanIntervalMs).toBe(6 * MIN);
    must(await stub.next(1));
    for (let i = 0; i < 3; i++) {
      await stub.testAdvanceClock(2 * MIN);
      must(await stub.next(1));
    }
    c = await consoleOf(stub);
    expect(c.eta.coldStart).toBe(false);
    expect(c.eta.intervals).toBe(3);
    expect(c.eta.meanIntervalMs).toBeGreaterThan(2 * MIN - 2000);
    expect(c.eta.meanIntervalMs).toBeLessThan(2 * MIN + 2000);
  });

  it("QUE-13: an outlier interval is capped at 5x the median", async () => {
    const { stub } = await seedQueue();
    for (let i = 0; i < 6; i++) await join(stub);
    must(await stub.next(1));
    for (let i = 0; i < 3; i++) {
      await stub.testAdvanceClock(MIN);
      must(await stub.next(1));
    }
    await stub.testAdvanceClock(60 * MIN);
    must(await stub.next(1));
    const last = await runInDurableObject(
      stub,
      (_i: QueueDO, state) =>
        state.storage.sql
          .exec<{ ms: number }>(
            "SELECT ms FROM intervals ORDER BY id DESC LIMIT 1",
          )
          .one().ms,
    );
    expect(last).toBeLessThanOrEqual(5 * MIN + 5000);
  });

  it("QUE-14: token range is ordered, grows with position, and low is never in the past", async () => {
    const { stub } = await seedQueue();
    const t = [];
    for (let i = 0; i < 5; i++) t.push(await join(stub));
    const views = await Promise.all(t.map((x) => view(stub, x.id)));
    const now = Date.now();
    let prevHigh = 0;
    for (const v of views) {
      expect(v.etaLowMs).not.toBeNull();
      expect(v.etaLowMs as number).toBeGreaterThanOrEqual(now - 1000);
      expect(v.etaLowMs as number).toBeLessThan(v.etaHighMs as number);
      expect(v.beBackByMs as number).toBeLessThanOrEqual(v.etaHighMs as number);
      expect(v.etaHighMs as number).toBeGreaterThan(prevHigh);
      expect(v.leaveHomeByMs).toBeNull();
      prevHigh = v.etaHighMs as number;
    }
    const sum = await stub.getSummary();
    expect(sum.waiting).toBe(5);
    expect(sum.waitLowMs as number).toBeLessThan(sum.waitHighMs as number);
  });
});

describe("QueueDO timers, outbox and persistence", () => {
  it("QUE-16: earliestDue picks the earliest pending time", () => {
    expect(
      earliestDue({
        graceExpiry: 500,
        snapshotFlush: 300,
        outboxRetry: null,
        headBackAlert: 900,
        hourlyFlush: 400,
        farFanout: null,
      }),
    ).toBe(300);
    expect(
      earliestDue({
        graceExpiry: null,
        snapshotFlush: null,
        outboxRetry: null,
        headBackAlert: null,
        hourlyFlush: null,
        farFanout: null,
      }),
    ).toBeNull();
  });

  it("QUE-16: the alarm is set to the earliest due item (grace expiry before the hourly flush)", async () => {
    const { stub } = await seedQueue({ settings: { graceMinutes: 2 } });
    const a = await join(stub);
    must(await stub.next(1));
    must(await stub.noShow(a.id));
    const graceUntil = (await view(stub, a.id)).graceUntil as number;
    const alarm = await runInDurableObject(stub, (_i: QueueDO, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).not.toBeNull();
    // Offset is 0 for this fresh queue, so real alarm time = virtual due time.
    expect(alarm as number).toBeLessThanOrEqual(graceUntil);
    expect(alarm as number).toBeGreaterThan(Date.now());
  });

  it("QUE-18/19: token rows, the snapshot and hourly analytics land in D1 through the outbox", async () => {
    const { stub, queueId, businessId } = await seedQueue();
    const a = await join(stub);
    await join(stub);
    const row = await env.DB.prepare(
      "SELECT state, number, series, queue_id, business_id, rev FROM tokens WHERE id = ?",
    )
      .bind(a.id)
      .first();
    expect(row).toMatchObject({
      state: "WAITING",
      number: 1,
      series: "R",
      queue_id: queueId,
      business_id: businessId,
    });
    const snap = await env.DB.prepare(
      "SELECT is_open, waiting, lat FROM queue_snapshots WHERE queue_id = ?",
    )
      .bind(queueId)
      .first();
    expect(snap).toMatchObject({ is_open: 1 });

    must(await stub.next(1));
    must(await stub.close());
    const snapClosed = await env.DB.prepare(
      "SELECT is_open, waiting FROM queue_snapshots WHERE queue_id = ?",
    )
      .bind(queueId)
      .first();
    expect(snapClosed).toEqual({ is_open: 0, waiting: 0 });
    const analytics = await env.DB.prepare(
      "SELECT SUM(joins) AS joins, SUM(waits) AS waits FROM analytics_hourly WHERE queue_id = ?",
    )
      .bind(queueId)
      .first();
    expect(analytics).toEqual({ joins: 2, waits: 1 });
    expect(await stub.pendingOutbox()).toBe(0);
  });

  it("F2: a burst of joins is batched to D1 and every token row exists when its join returns", async () => {
    const { stub } = await seedQueue();
    const joined = await Promise.all(
      Array.from({ length: 30 }, async () => {
        const t = await join(stub);
        // read-your-writes: the Worker's GET /tokens/:id reads D1 first
        const row = await env.DB.prepare(
          "SELECT state FROM tokens WHERE id = ?",
        )
          .bind(t.id)
          .first();
        return { t, row };
      }),
    );
    for (const { row } of joined) expect(row).toEqual({ state: "WAITING" });
    expect(await stub.pendingOutbox()).toBe(0);
    // Inline drains leave no near-term alarm behind (F1).
    const alarm = await runInDurableObject(stub, (_i: QueueDO, state) =>
      state.storage.getAlarm(),
    );
    if (alarm !== null) expect(alarm).toBeGreaterThan(Date.now() + 1_000);
  });

  it("QUE-18/19: after a simulated D1 outage the outbox retries on the alarm and nothing is lost", async () => {
    const { stub, queueId } = await seedQueue();
    outboxFaults.failD1 = 1000;
    const a = await join(stub);
    must(await stub.next(1));
    must(await stub.close());
    expect(
      await env.DB.prepare("SELECT id FROM tokens WHERE id = ?")
        .bind(a.id)
        .first(),
    ).toBeNull();
    expect(await stub.pendingOutbox()).toBeGreaterThan(0);

    outboxFaults.failD1 = 0;
    await stub.testAdvanceClock(6_000); // past the first backoff (5 s)
    await runDurableObjectAlarm(stub);
    expect(await stub.pendingOutbox()).toBe(0);
    const row = await env.DB.prepare(
      "SELECT state, end_reason FROM tokens WHERE id = ?",
    )
      .bind(a.id)
      .first();
    expect(row).toEqual({ state: "EXPIRED", end_reason: "closed" });
    const analytics = await env.DB.prepare(
      "SELECT SUM(joins) AS joins FROM analytics_hourly WHERE queue_id = ?",
    )
      .bind(queueId)
      .first();
    expect(analytics).toEqual({ joins: 1 });
  });

  it("QUE-19: an analytics outbox item applied twice is only counted once", async () => {
    const { queueId, businessId } = await seedQueue({ open: false });
    const { applyOutboxItem } = await import("../src/queue/outbox");
    const item = {
      id: crypto.randomUUID(),
      kind: "analytics" as const,
      payload: JSON.stringify({
        queueId,
        businessId,
        hourStart: 0,
        counts: {
          joins: 2,
          leaves: 0,
          served: 1,
          no_shows: 0,
          cancels: 0,
          sum_wait_ms: 10,
          waits: 1,
          sum_interval_ms: 0,
          intervals: 0,
          eta_hits: 0,
          eta_total: 0,
        },
      }),
      attempts: 0,
      next_attempt_at: 0,
      created_at: 0,
    };
    const deps = { d1: env.DB, push: push.transport };
    await applyOutboxItem(item, deps, Date.now());
    await applyOutboxItem(item, deps, Date.now());
    const r = await env.DB.prepare(
      "SELECT joins FROM analytics_hourly WHERE queue_id = ? AND hour_start = 0",
    )
      .bind(queueId)
      .first();
    expect(r).toEqual({ joins: 2 });
  });

  it("QUE-20: state survives a Durable Object restart (re-get the stub)", async () => {
    const { stub, queueId } = await seedQueue();
    const a = await join(stub);
    const b = await join(stub);
    must(await stub.next(1));
    const before = await consoleOf(stub);
    await evictDurableObject(stub);
    const again = stubFor(queueId);
    const after = await consoleOf(again);
    expect({
      ...after,
      updatedAt: 0,
      eta: { ...after.eta, waitLowMs: 0, waitHighMs: 0 },
    }).toEqual({
      ...before,
      updatedAt: 0,
      eta: { ...before.eta, waitLowMs: 0, waitHighMs: 0 },
    });
    expect((await view(again, b.id)).peopleAhead).toBe(0);
    expect((await view(again, a.id)).state).toBe("CALLED");
    // numbering continues
    expect((await join(again)).number).toBe(3);
  });

  it("QUE-21: allocation is idempotent by paymentOrderId (also in parallel)", async () => {
    const { stub } = await seedQueue();
    const userId = crypto.randomUUID();
    const input = {
      method: "remote" as const,
      userId,
      cls: "regular" as const,
      paymentOrderId: `order_${crypto.randomUUID()}`,
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => stub.allocate(input)),
    );
    const values = results.map(must);
    expect(new Set(values.map((v) => v.token.id)).size).toBe(1);
    expect(values.filter((v) => v.created)).toHaveLength(1);
    expect(values[0].token.paid).toBe(true);
    expect((await consoleOf(stub)).counts.waiting).toBe(1);
    // a paid token doesn't block a free walk-in for the same user
    await join(stub, userId);
  });
});

describe("QueueDO alerts", () => {
  it("ALR-03/04: called, next and grace alerts are sent once per token, with channel and data", async () => {
    const { stub, queueId } = await seedQueue();
    const ua = crypto.randomUUID();
    const ub = crypto.randomUUID();
    await addDevice(ua, `ExponentPushToken[a-${ua}]`);
    await addDevice(ub, `ExponentPushToken[b-${ub}]`);
    const a = await join(stub, ua);
    const b = await join(stub, ub);
    must(await stub.next(1)); // a called; b is next
    expect(push.kinds(a.id)).toEqual(["called"]);
    expect(push.kinds(b.id)).toEqual(["next"]);
    const msg = push.sent.find((m) => m.data.tokenId === a.id);
    expect(msg).toMatchObject({
      channelId: "queue-alerts",
      priority: "high",
      data: { tokenId: a.id, queueId, kind: "called" },
    });
    expect(msg?.body).toContain("counter 1");

    must(await stub.noShow(a.id));
    must(await stub.admit(a.id));
    must(await stub.noShow(a.id)); // second no-show: no second grace alert
    must(await stub.pause());
    must(await stub.resume());
    must(await stub.pause()); // second pause: no second paused alert
    expect(push.kinds(a.id)).toEqual(["called", "grace_started"]);
    expect(push.kinds(b.id)).toEqual(["next", "queue_paused"]);

    const tickets = await env.DB.prepare(
      "SELECT kind FROM push_tickets WHERE token_id = ? ORDER BY sent_at",
    )
      .bind(a.id)
      .all();
    expect(tickets.results.map((r) => r.kind)).toEqual([
      "called",
      "grace_started",
    ]);
  });

  it("ALR-03: queue_closed alert; push retried after an Expo outage without duplicates", async () => {
    const { stub } = await seedQueue();
    const u = crypto.randomUUID();
    await addDevice(u, `ExponentPushToken[c-${u}]`);
    const a = await join(stub, u);
    push.failNextSends(1);
    must(await stub.close());
    expect(push.kinds(a.id)).toEqual([]);
    await stub.testAdvanceClock(6_000);
    await runDurableObjectAlarm(stub);
    expect(push.kinds(a.id)).toEqual(["queue_closed"]);
    await stub.testAdvanceClock(60_000);
    await runDurableObjectAlarm(stub);
    expect(push.kinds(a.id)).toEqual(["queue_closed"]);
  });

  it("ALR-03: head-back alert when the expected call is within 15 min (not right after joining)", async () => {
    const { stub } = await seedQueue({ settings: { serviceMinutesHint: 10 } });
    const users = Array.from({ length: 4 }, () => crypto.randomUUID());
    for (const u of users) await addDevice(u, `ExponentPushToken[h-${u}]`);
    const t = [];
    for (const u of users) t.push(await join(stub, u));
    // t[2] has 2 ahead → expected ~30 min; t[1] ~20 min. Nobody alerted yet (just joined).
    expect(t.flatMap((x) => push.kinds(x.id))).toEqual([]);
    await stub.testAdvanceClock(10 * MIN);
    await runDurableObjectAlarm(stub);
    // after 10 min: t[1] expected ~10 min away → head back; t[2] ~20 min → not yet
    expect(push.kinds(t[1].id)).toContain("head_back");
    expect(push.kinds(t[2].id)).not.toContain("head_back");
    expect(push.kinds(t[0].id)).not.toContain("head_back"); // head gets "next" instead
  });

  it("F2: close alerts every waiting token once, batched (one dead device removed)", async () => {
    const { stub } = await seedQueue();
    const users = Array.from({ length: 30 }, () => crypto.randomUUID());
    const dead = `ExponentPushToken[dead-${users[5]}]`;
    for (const u of users) await addDevice(u, `ExponentPushToken[z-${u}]`);
    await addDevice(users[5], dead);
    push.dead.add(dead);
    const t = [];
    for (const u of users) t.push(await join(stub, u));
    must(await stub.close());
    expect(await stub.pendingOutbox()).toBe(0);
    for (const x of t) {
      expect(push.kinds(x.id).filter((k) => k === "queue_closed")).toHaveLength(
        x.id === t[5].id ? 2 : 1, // two devices for users[5]
      );
    }
    const tickets = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM push_tickets WHERE kind = 'queue_closed' AND token_id IN (${t.map(() => "?").join(",")})`,
    )
      .bind(...t.map((x) => x.id))
      .first();
    expect(tickets).toEqual({ n: 30 });
    const gone = await env.DB.prepare(
      "SELECT 1 FROM devices WHERE expo_push_token = ?",
    )
      .bind(dead)
      .first();
    expect(gone).toBeNull();
  });

  it("ALR-02: a DeviceNotRegistered ticket removes the device", async () => {
    const { stub } = await seedQueue();
    const u = crypto.randomUUID();
    const tok = `ExponentPushToken[dead-${u}]`;
    await addDevice(u, tok);
    push.dead.add(tok);
    const a = await join(stub, u);
    await join(stub);
    must(await stub.next(1));
    expect(push.kinds(a.id)).toEqual(["called"]);
    const dev = await env.DB.prepare(
      "SELECT 1 FROM devices WHERE expo_push_token = ?",
    )
      .bind(tok)
      .first();
    expect(dev).toBeNull();
  });
});

describe("QueueDO live updates (QUE-17)", () => {
  it("a token socket gets its state on connect and an update after Next", async () => {
    const { stub } = await seedQueue();
    await join(stub);
    const b = await join(stub);
    const res = await stub.fetch(`https://queue-do/live?tokenId=${b.id}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(101);
    const { ws, messages } = collect(res);
    const first = await waitFor(() => messages.find((m) => m.type === "token"));
    if (first.type === "token") expect(first.token.peopleAhead).toBe(1);
    must(await stub.next(1));
    const update = await waitFor(() =>
      messages.find((m) => m.type === "token" && m.token.peopleAhead === 0),
    );
    if (update.type === "token") expect(update.token.nowServing).toBe("1");
    ws.close();
  });

  it("a console socket gets the full state after each change; ping → pong", async () => {
    const { stub } = await seedQueue();
    const res = await stub.fetch("https://queue-do/live?console=1", {
      headers: { Upgrade: "websocket" },
    });
    const { ws, messages } = collect(res);
    await waitFor(() => messages.find((m) => m.type === "queue"));
    await join(stub);
    await waitFor(() =>
      messages.find(
        (m) => m.type === "queue" && m.console.counts.waiting === 1,
      ),
    );
    ws.send('{"type":"ping"}');
    await waitFor(() => messages.find((m) => m.type === "pong"));
    ws.close();
  });

  it("tokens beyond the first 20 positions are updated at most every 30 s", async () => {
    const { stub } = await seedQueue();
    const t = [];
    for (let i = 0; i < 24; i++) t.push(await join(stub));
    const far = t[23];
    const res = await stub.fetch(`https://queue-do/live?tokenId=${far.id}`, {
      headers: { Upgrade: "websocket" },
    });
    const { ws, messages } = collect(res);
    await waitFor(() => messages.length >= 1);
    must(await stub.next(1)); // first far broadcast: due (never sent)
    await waitFor(() => messages.length >= 2);
    must(await stub.next(1)); // within 30 s: held back
    must(await stub.next(1));
    await new Promise((r) => setTimeout(r, 100));
    expect(messages).toHaveLength(2);
    await stub.testAdvanceClock(31_000);
    await runDurableObjectAlarm(stub);
    const latest = await waitFor(() => messages.length >= 3 && messages[2]);
    if (latest.type === "token") expect(latest.token.peopleAhead).toBe(20);
    ws.close();
  });

  it("a held-back far update that is no longer owed doesn't keep re-arming the alarm", async () => {
    const { stub } = await seedQueue();
    const t = [];
    for (let i = 0; i < 24; i++) t.push(await join(stub));
    const far = t[23];
    const res = await stub.fetch(`https://queue-do/live?tokenId=${far.id}`, {
      headers: { Upgrade: "websocket" },
    });
    const { ws, messages } = collect(res);
    await waitFor(() => messages.length >= 1);
    must(await stub.next(1)); // first far broadcast (due)
    await waitFor(() => messages.length >= 2);
    must(await stub.next(1)); // held back → far update pending
    // The far customer leaves: their socket is updated at once (touched), so
    // the pending far update is owed to nobody.
    must(await stub.leave(far.id, null));
    const left = await waitFor(() =>
      messages.find((m) => m.type === "token" && m.token.state === "LEFT"),
    );
    expect(left).toBeTruthy();
    await stub.testAdvanceClock(31_000);
    await runDurableObjectAlarm(stub);
    const { farState, alarm } = await runInDurableObject(
      stub,
      async (_i: QueueDO, state) => ({
        farState: JSON.parse(
          state.storage.sql
            .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'far'")
            .one().value,
        ) as { dirty: boolean },
        alarm: await state.storage.getAlarm(),
      }),
    );
    expect(farState.dirty).toBe(false);
    // Before the fix the alarm was set ~250 ms ahead, forever.
    if (alarm !== null) expect(alarm).toBeGreaterThan(Date.now() + 1_000);
    ws.close();
  });

  it("F3: grace expiry on the alarm is pushed to the token's socket", async () => {
    const { stub } = await seedQueue({ settings: { graceMinutes: 1 } });
    const a = await join(stub);
    await join(stub);
    must(await stub.next(1));
    must(await stub.noShow(a.id));
    const res = await stub.fetch(`https://queue-do/live?tokenId=${a.id}`, {
      headers: { Upgrade: "websocket" },
    });
    const { ws, messages } = collect(res);
    const first = await waitFor(() => messages.find((m) => m.type === "token"));
    if (first.type === "token") expect(first.token.state).toBe("GRACE");
    await stub.testAdvanceClock(61_000);
    await runDurableObjectAlarm(stub);
    const last = await waitFor(() =>
      messages.find((m) => m.type === "token" && m.token.state === "EXPIRED"),
    );
    if (last.type === "token") expect(last.token.endReason).toBe("no_show");
    expect((await view(stub, a.id)).state).toBe("EXPIRED");
    ws.close();
  });
});
