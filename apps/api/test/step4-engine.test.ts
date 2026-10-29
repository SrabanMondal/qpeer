import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  CHECK_CODE_ALPHABET,
  ConsoleState,
  TokenView,
  type WeeklyHours,
} from "@qpeer/shared";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { pushOverride } from "../src/modules/notifications/expo-push";
import { outboxFaults } from "../src/queue/outbox";
import {
  addDevice,
  fakePush,
  MIN,
  must,
  mustFail,
  seedQueue,
} from "./queue-helpers";

/**
 * Step 4 engine (decided 2026-10-18): missed turn (QUE-22…29), Skip K
 * (QUE-06), Priority Pass + upgrade (PRI-02…10), credit counter (PRI-06),
 * people-ahead range (PRI-08) and the money decisions the DO hands to D1.
 */

let push: ReturnType<typeof fakePush>;

beforeAll(() => {
  push = fakePush();
  pushOverride.transport = push.transport;
});

afterEach(() => {
  outboxFaults.failD1 = 0;
});

type Stub = Awaited<ReturnType<typeof seedQueue>>["stub"];

const ALL_DAY: WeeklyHours = {
  mon: [{ from: "00:00", to: "23:59" }],
  tue: [{ from: "00:00", to: "23:59" }],
  wed: [{ from: "00:00", to: "23:59" }],
  thu: [{ from: "00:00", to: "23:59" }],
  fri: [{ from: "00:00", to: "23:59" }],
  sat: [{ from: "00:00", to: "23:59" }],
  sun: [{ from: "00:00", to: "23:59" }],
};

async function join(stub: Stub, userId: string | null = crypto.randomUUID()) {
  const r = must(
    await stub.allocate({ method: "walkin", userId, cls: "regular" }),
  );
  return TokenView.parse(r.token);
}

async function reserve(stub: Stub, userId = crypto.randomUUID()) {
  const order = `order_${crypto.randomUUID()}`;
  const r = must(
    await stub.allocate({
      method: "remote",
      userId,
      cls: "regular",
      paymentOrderId: order,
      paymentId: crypto.randomUUID(),
    }),
  );
  return { token: TokenView.parse(r.token), order, userId };
}

/** A paid pass, checked in at once unless `checkIn: false`. */
async function pass(
  stub: Stub,
  opts: { userId?: string; checkIn?: boolean } = {},
) {
  const userId = opts.userId ?? crypto.randomUUID();
  const order = `order_${crypto.randomUUID()}`;
  const booked = must(
    await stub.book({
      userId,
      paymentOrderId: order,
      paymentId: crypto.randomUUID(),
      deviceHash: null,
    }),
  );
  if (opts.checkIn === false) {
    return { token: TokenView.parse(booked.token), order, userId };
  }
  const t = TokenView.parse(must(await stub.checkIn(booked.token.id, userId)));
  return { token: t, order, userId };
}

async function view(stub: Stub, id: string) {
  return TokenView.parse(must(await stub.getToken(id)).token);
}

async function consoleOf(stub: Stub) {
  return ConsoleState.parse(await stub.getState());
}

/** Calls the next token and returns its label. */
async function nextLabel(stub: Stub): Promise<string> {
  const c = ConsoleState.parse(must(await stub.next(1)));
  return c.serving[0]?.label ?? "-";
}

async function missOnce(stub: Stub, tokenId: string) {
  // The token must be at the head: call it, no-show, let grace run out.
  must(await stub.next(1));
  must(await stub.noShow(tokenId));
  await stub.testAdvanceClock(MIN + 1000);
  await runDurableObjectAlarm(stub);
}

async function paymentRow(order: string) {
  return env.DB.prepare(
    "SELECT status, refund_paise, reason FROM payments WHERE razorpay_order_id = ?",
  )
    .bind(order)
    .first<{ status: string; refund_paise: number | null; reason: string }>();
}

/** D1 payment row the DO's `payment` outbox items act on. */
async function seedPayment(
  queueId: string,
  businessId: string,
  order: string,
  amount = 2000,
  status = "allocated",
) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO payments (id, user_id, queue_id, business_id, token_id, kind, amount_paise,
       business_share_pct, device_hash, razorpay_order_id, razorpay_payment_id, status,
       expires_at, created_at, updated_at)
     VALUES (?, 'u', ?, ?, NULL, 'reservation', ?, 70, NULL, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      queueId,
      businessId,
      amount,
      order,
      `pay_${crypto.randomUUID()}`,
      status,
      now + 30 * MIN,
      now,
      now,
    )
    .run();
}

describe("Missed turn (QUE-22…29, ALR-08)", () => {
  it("QUE-22/ALR-08/QUE-26: grace end → MISSED, out of the order, one `missed` push, others' people ahead unchanged", async () => {
    const { stub } = await seedQueue({ settings: { graceMinutes: 1 } });
    const user = crypto.randomUUID();
    await addDevice(user, `ExponentPushToken[m-${user}]`);
    const a = await join(stub, user);
    const b = await join(stub);
    const c = await join(stub);
    must(await stub.next(1)); // a called
    expect((await view(stub, c.id)).peopleAhead).toBe(1);
    must(await stub.noShow(a.id));
    expect((await view(stub, c.id)).peopleAhead).toBe(1);
    const g = await view(stub, a.id);
    expect(g.state).toBe("GRACE");
    expect(g.graceEndsAt).toBe(g.graceUntil);
    await stub.testAdvanceClock(MIN + 1000);
    await runDurableObjectAlarm(stub);
    await stub.flushOutbox();
    const m = await view(stub, a.id);
    expect(m.state).toBe("MISSED");
    expect(m.rejoinAvailable).toBe(true);
    expect(m.rejoinUntil).toBe((m.missedAt ?? 0) + 15 * MIN);
    expect((await view(stub, c.id)).peopleAhead).toBe(1);
    expect((await view(stub, b.id)).peopleAhead).toBe(0);
    const con = await consoleOf(stub);
    expect(con.counts.waiting).toBe(2);
    expect(con.counts.missed).toBe(1);
    expect(con.missed?.[0].id).toBe(a.id);
    expect(push.kinds(a.id).filter((k) => k === "missed")).toHaveLength(1);
    // Analytics: one no-show per miss.
    const missedPush = push.sent.find(
      (s) => s.data.tokenId === a.id && s.data.kind === "missed",
    );
    expect(missedPush?.body).toBe(
      "You missed your turn. Tap I'm here when you arrive.",
    );
  });

  it("QUE-23/QUE-27: 'I'm here' within the window → behind K = ceil(15 ÷ 5) = 3 of its class; once only", async () => {
    const { stub } = await seedQueue({ settings: { graceMinutes: 1 } });
    const user = crypto.randomUUID();
    const a = await join(stub, user);
    const rest = [];
    for (let i = 0; i < 5; i++) rest.push(await join(stub));
    await missOnce(stub, a.id);
    mustFail(await stub.rejoin(a.id, crypto.randomUUID()), "not_found");
    const back = TokenView.parse(must(await stub.rejoin(a.id, user)));
    expect(back.state).toBe("WAITING");
    expect(back.peopleAhead).toBe(3);
    expect(back.rejoined).toBe(true);
    // Only those behind the insert point moved back by one (QUE-26).
    expect((await view(stub, rest[2].id)).peopleAhead).toBe(2);
    expect((await view(stub, rest[3].id)).peopleAhead).toBe(4);
    mustFail(await stub.rejoin(a.id, user), "invalid_state");
  });

  it("QUE-27: K follows the service time: 3 min → behind 5, 30 min → behind 1; after the late window → the end", async () => {
    for (const [hint, k] of [
      [3, 5],
      [30, 1],
    ] as const) {
      const { stub } = await seedQueue({
        settings: { graceMinutes: 1, serviceMinutesHint: hint },
      });
      const user = crypto.randomUUID();
      const a = await join(stub, user);
      for (let i = 0; i < 7; i++) await join(stub);
      await missOnce(stub, a.id);
      const v = TokenView.parse(must(await stub.rejoin(a.id, user)));
      expect(v.peopleAhead).toBe(k);
    }
    const { stub } = await seedQueue({
      settings: { graceMinutes: 1, lateWindowMin: 5 },
    });
    const user = crypto.randomUUID();
    const a = await join(stub, user);
    for (let i = 0; i < 6; i++) await join(stub);
    await missOnce(stub, a.id);
    await stub.testAdvanceClock(6 * MIN);
    const v = TokenView.parse(must(await stub.rejoin(a.id, user)));
    expect(v.peopleAhead).toBe(6); // the end of the line
    // "No limit" keeps the K rule however late.
    const s2 = await seedQueue({
      settings: { graceMinutes: 1, lateWindowMin: null },
    });
    const u2 = crypto.randomUUID();
    const b = await join(s2.stub, u2);
    for (let i = 0; i < 6; i++) await join(s2.stub);
    await missOnce(s2.stub, b.id);
    expect((await view(s2.stub, b.id)).rejoinUntil).toBeNull();
    await s2.stub.testAdvanceClock(600 * MIN);
    expect(
      TokenView.parse(must(await s2.stub.rejoin(b.id, u2))).peopleAhead,
    ).toBe(3);
  });

  it("QUE-24/C5: second miss → EXPIRED; free walk-in gets a strike, a paid reservation is forfeited with no strike", async () => {
    const { stub, queueId, businessId } = await seedQueue({
      settings: { graceMinutes: 1 },
    });
    const free = crypto.randomUUID();
    const a = await join(stub, free);
    await missOnce(stub, a.id);
    must(await stub.rejoin(a.id, free));
    await missOnce(stub, a.id);
    await stub.flushOutbox();
    const ended = await view(stub, a.id);
    expect(ended.state).toBe("EXPIRED");
    expect(ended.endReason).toBe("no_show");
    const strikes = async (tokenId: string) =>
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM free_lane_strikes WHERE token_id = ?",
        )
          .bind(tokenId)
          .first<{ n: number }>()
      )?.n;
    expect(await strikes(a.id)).toBe(1);

    const r = await reserve(stub);
    await seedPayment(queueId, businessId, r.order);
    await missOnce(stub, r.token.id);
    must(await stub.rejoin(r.token.id, r.userId));
    await missOnce(stub, r.token.id);
    await stub.flushOutbox();
    expect((await view(stub, r.token.id)).state).toBe("EXPIRED");
    expect(await strikes(r.token.id)).toBe(0);
    expect((await paymentRow(r.order))?.status).toBe("forfeited");
    const ledger = await env.DB.prepare(
      "SELECT kind, amount_paise FROM ledger_entries WHERE id LIKE 'forfeit:%' AND payment_id = (SELECT id FROM payments WHERE razorpay_order_id = ?)",
    )
      .bind(r.order)
      .all();
    expect(ledger.results).toEqual([{ kind: "forfeit", amount_paise: 0 }]);
  });

  it("QUE-28/PAY-14/15: MISSED never carries over; normal close forfeits a paid MISSED fee, an early close refunds it", async () => {
    const { stub, queueId, businessId } = await seedQueue({
      settings: { graceMinutes: 1, ticketValidityMin: 2880 },
    });
    const a = await join(stub);
    const r = await reserve(stub);
    await seedPayment(queueId, businessId, r.order);
    await missOnce(stub, a.id);
    await missOnce(stub, r.token.id);
    const kept = await join(stub); // still valid at close: carries over
    must(await stub.close());
    await stub.flushOutbox();
    expect((await view(stub, a.id)).state).toBe("EXPIRED");
    expect((await view(stub, kept.id)).carriedOver).toBe(true);
    expect((await paymentRow(r.order))?.status).toBe("forfeited");

    const early = await seedQueue({ settings: { graceMinutes: 1 } });
    await early.stub.setHours(ALL_DAY);
    const r2 = await reserve(early.stub);
    await seedPayment(early.queueId, early.businessId, r2.order);
    await missOnce(early.stub, r2.token.id);
    const closed = must(await early.stub.close());
    expect(closed.paidTokens).toEqual([
      { tokenId: r2.token.id, orderId: r2.order, action: "refund" },
    ]);
    await early.stub.flushOutbox();
    expect(await paymentRow(r2.order)).toMatchObject({
      status: "refund_due",
      refund_paise: 2000,
    });
  });

  it("QUE-29/R2: check code at allocation (4 chars, no look-alikes); staff rejoin by number + code, once", async () => {
    const { stub } = await seedQueue({ settings: { graceMinutes: 1 } });
    const user = crypto.randomUUID();
    const a = await join(stub, user);
    for (let i = 0; i < 4; i++) await join(stub);
    expect(a.checkCode).toMatch(/^[A-Z2-9]{4}$/);
    for (const ch of a.checkCode ?? "") {
      expect(CHECK_CODE_ALPHABET).toContain(ch);
    }
    const d1 = await env.DB.prepare(
      "SELECT check_code FROM tokens WHERE id = ?",
    )
      .bind(a.id)
      .first<{ check_code: string }>();
    expect(d1?.check_code).toBe(a.checkCode);
    await missOnce(stub, a.id);
    const wrong = a.checkCode === "2222" ? "3333" : "2222";
    mustFail(
      await stub.staffRejoin({
        series: "R",
        number: a.number,
        checkCode: wrong,
      }),
      "not_found",
    );
    const r = must(
      await stub.staffRejoin({
        series: "R",
        number: a.number,
        checkCode: (a.checkCode ?? "").toLowerCase(),
      }),
    );
    expect(r.token.state).toBe("WAITING");
    expect(r.token.peopleAhead).toBe(3);
    mustFail(
      await stub.staffRejoin({
        series: "R",
        number: a.number,
        checkCode: a.checkCode ?? "",
      }),
      "invalid_state",
    );
  });

  it("QUE-06: Skip uses the same K, fixed at the skip (3 min/person → behind 5)", async () => {
    const { stub } = await seedQueue({ settings: { serviceMinutesHint: 3 } });
    const t = [];
    for (let i = 0; i < 8; i++) t.push(await join(stub));
    must(await stub.skip(t[0].id));
    const labels = (await consoleOf(stub)).waiting.map((w) => w.label);
    expect(labels).toEqual(["2", "3", "4", "5", "6", "1", "7", "8"]);
  });
});

describe("Priority Pass + upgrade (PRI-02…10)", () => {
  const ON = { priorityEnabled: true, priorityPerRegular: 2 };

  it("PRI-02: book → BOOKED (no number, not waiting); idempotent; one active ticket; off / sold out", async () => {
    const off = await seedQueue();
    mustFail(
      await off.stub.book({
        userId: "u",
        paymentOrderId: "o1",
        paymentId: "p1",
        deviceHash: null,
      }),
      "priority_off",
    );
    const { stub } = await seedQueue({
      settings: { ...ON, priorityDailyCap: 2 },
    });
    const user = crypto.randomUUID();
    const input = {
      userId: user,
      paymentOrderId: `o_${crypto.randomUUID()}`,
      paymentId: crypto.randomUUID(),
      deviceHash: null,
    };
    const [x, y] = await Promise.all([stub.book(input), stub.book(input)]);
    const bx = must(x);
    const by = must(y);
    expect(bx.token.id).toBe(by.token.id);
    expect([bx.created, by.created].sort()).toEqual([false, true]);
    const t = TokenView.parse(bx.token);
    expect(t.state).toBe("BOOKED");
    expect(t.number).toBe(0);
    expect(t.validUntil).not.toBeNull();
    expect(t.checkCode).toMatch(/^[A-Z2-9]{4}$/);
    expect((await consoleOf(stub)).counts).toMatchObject({
      waiting: 0,
      booked: 1,
    });
    mustFail(
      await stub.book({ ...input, paymentOrderId: "other" }),
      "already_in_queue",
    );
    mustFail(
      await stub.allocate({ method: "walkin", userId: user, cls: "regular" }),
      "already_in_queue",
    );
    await pass(stub, { checkIn: false });
    mustFail(
      await stub.book({ ...input, userId: "z", paymentOrderId: "o3" }),
      "sold_out",
    );
  });

  it("PRI-03: check-in → priority lane by check-in time with P numbers; closed / window ended rejected", async () => {
    const { stub } = await seedQueue({ settings: ON });
    const first = await pass(stub, { checkIn: false });
    const second = await pass(stub, { checkIn: false });
    mustFail(await stub.checkIn(first.token.id, "someone-else"), "not_found");
    // Second holder arrives first: P1 by check-in time, not purchase time.
    const s = TokenView.parse(
      must(await stub.checkIn(second.token.id, second.userId)),
    );
    const f = TokenView.parse(
      must(await stub.checkIn(first.token.id, first.userId)),
    );
    expect(s.label).toBe("P1");
    expect(f.label).toBe("P2");
    expect(f.lane).toBe("priority");
    expect(f.checkedInAt).not.toBeNull();
    expect(f.validUntil).toBeNull();
    must(await stub.checkIn(first.token.id, first.userId)); // idempotent

    const closed = await seedQueue({ settings: ON, open: false });
    const p = await pass(closed.stub, { checkIn: false });
    mustFail(await closed.stub.checkIn(p.token.id, p.userId), "queue_closed");
    const timed = await seedQueue({
      settings: { ...ON, priorityValidityMin: 60 },
    });
    const q = await pass(timed.stub, { checkIn: false });
    await timed.stub.testAdvanceClock(61 * MIN);
    mustFail(await timed.stub.checkIn(q.token.id, q.userId), "invalid_state");
  });

  it("PRI-06/C1: credits start at 0 → R R P; triage first and adds none; no-show counts; Undo restores credits", async () => {
    const { stub } = await seedQueue({
      settings: { ...ON, triageDailyCap: 5 },
    });
    for (let i = 0; i < 5; i++) await join(stub);
    await pass(stub);
    await pass(stub);
    must(await stub.insertTriage());
    const order = [];
    for (let i = 0; i < 4; i++) order.push(await nextLabel(stub));
    expect(order).toEqual(["T1", "1", "2", "P1"]);
    let c = await consoleOf(stub);
    expect(c.priority?.credits).toBe(0);
    // A regular call that ends as No-show still adds its credit.
    expect(await nextLabel(stub)).toBe("3");
    must(await stub.noShow((await consoleOf(stub)).serving[0].id));
    expect((await consoleOf(stub)).priority?.credits).toBe(1);
    expect(await nextLabel(stub)).toBe("4");
    c = await consoleOf(stub);
    expect(c.priority?.credits).toBe(2);
    expect(c.waiting[0].label).toBe("P2"); // due now
    expect(await nextLabel(stub)).toBe("P2");
    expect((await consoleOf(stub)).priority?.credits).toBe(0);
    must(await stub.undoNext());
    expect((await consoleOf(stub)).priority?.credits).toBe(2);
    expect((await consoleOf(stub)).waiting[0].label).toBe("P2");
    // Session open resets the counter (C1).
    must(await stub.close());
    must(await stub.open());
    expect((await consoleOf(stub)).priority?.credits).toBe(0);
  });

  it("PRI-06: with no regulars waiting the priority head is called; credits never exceed N (no burst)", async () => {
    const { stub } = await seedQueue({
      settings: { ...ON, priorityPerRegular: 1 },
    });
    await pass(stub);
    expect(await nextLabel(stub)).toBe("P1");
    for (let i = 0; i < 4; i++) await join(stub);
    for (let i = 0; i < 3; i++) await nextLabel(stub);
    expect((await consoleOf(stub)).priority?.credits).toBe(1);
    await pass(stub);
    await pass(stub);
    expect(await nextLabel(stub)).toBe("P2");
    expect(await nextLabel(stub)).toBe("4");
    expect(await nextLabel(stub)).toBe("P3");
  });

  it("PRI-08/C3: a regular's people ahead is a range; console order follows the credit rule", async () => {
    const { stub } = await seedQueue({ settings: ON });
    const r = [];
    for (let i = 0; i < 5; i++) r.push(await join(stub));
    let v = await view(stub, r[4].id);
    expect([v.peopleAhead, v.peopleAheadHigh]).toEqual([4, 6]);
    await pass(stub);
    v = await view(stub, r[4].id);
    expect([v.peopleAhead, v.peopleAheadHigh]).toEqual([5, 6]);
    expect(v.etaHighMs).toBeGreaterThan(v.etaLowMs ?? 0);
    expect(v.priority).toEqual({
      enabled: true,
      perRegular: 2,
      feePaise: 10000,
    });
    const p = (await consoleOf(stub)).waiting.map((w) => w.label);
    expect(p).toEqual(["1", "2", "P1", "3", "4", "5"]);
    const sum = await stub.getSummary();
    expect(sum.priority).toMatchObject({ enabled: true, waiting: 1 });
    expect(sum.priority?.waitLowMs).not.toBeNull();
  });

  it("PRI-05/C2: upgrade moves the same WAITING ticket into the priority lane; offer hidden below the threshold", async () => {
    const { stub } = await seedQueue({ settings: ON });
    const users = [];
    const t = [];
    for (let i = 0; i < 8; i++) {
      const u = crypto.randomUUID();
      users.push(u);
      t.push(await join(stub, u));
    }
    const last = await view(stub, t[7].id);
    expect(last.upgrade?.show).toBe(true);
    expect(last.upgrade?.pricePaise).toBe(10000);
    expect(last.upgrade?.savingMin).toBeGreaterThanOrEqual(5);
    const first = await view(stub, t[0].id);
    expect(first.upgrade?.show).toBe(false); // nothing to save at the head
    mustFail(
      await stub.checkPurchase({
        kind: "upgrade",
        userId: users[0],
        tokenId: t[0].id,
      }),
      "invalid_state",
    );
    must(
      await stub.checkPurchase({
        kind: "upgrade",
        userId: users[7],
        tokenId: t[7].id,
      }),
    );
    const order = `o_${crypto.randomUUID()}`;
    const up = TokenView.parse(
      must(
        await stub.upgrade({
          tokenId: t[7].id,
          paymentOrderId: order,
          paymentId: "p",
        }),
      ),
    );
    expect(up.lane).toBe("priority");
    expect(up.label).toBe("8"); // keeps its number
    expect(up.paid).toBe(true);
    expect(up.upgrade).toBeNull();
    // Idempotent by the order; a second upgrade of the same ticket is refused.
    must(
      await stub.upgrade({
        tokenId: t[7].id,
        paymentOrderId: order,
        paymentId: "p",
      }),
    );
    mustFail(
      await stub.upgrade({
        tokenId: t[7].id,
        paymentOrderId: "o2",
        paymentId: "p",
      }),
      "invalid_state",
    );
    // Only WAITING tickets: a called ticket can't (→ the Worker refunds).
    must(await stub.next(1));
    mustFail(
      await stub.upgrade({
        tokenId: t[0].id,
        paymentOrderId: "o3",
        paymentId: "p",
      }),
      "invalid_state",
    );
  });

  it("PRI-09/10, C6: close refunds checked-in holders (also while paused) and they never carry over; BOOKED stays; window end forfeits", async () => {
    const { stub, queueId, businessId } = await seedQueue({
      settings: { ...ON, ticketValidityMin: 2880, priorityValidityMin: 120 },
    });
    const inLine = await pass(stub);
    const booked = await pass(stub, { checkIn: false });
    await seedPayment(queueId, businessId, inLine.order, 10000);
    await seedPayment(queueId, businessId, booked.order, 10000);
    must(await stub.pause());
    const r = must(await stub.close());
    expect(r.paidTokens).toEqual([
      { tokenId: inLine.token.id, orderId: inLine.order, action: "refund" },
    ]);
    await stub.flushOutbox();
    const v = await view(stub, inLine.token.id);
    expect(v.state).toBe("EXPIRED");
    expect(v.carriedOver).toBe(false);
    expect(await paymentRow(inLine.order)).toMatchObject({
      status: "refund_due",
      refund_paise: 10000,
    });
    expect((await view(stub, booked.token.id)).state).toBe("BOOKED");
    // Never checked in by the end of the window → EXPIRED, no refund.
    await stub.testAdvanceClock(121 * MIN);
    await runDurableObjectAlarm(stub);
    await stub.flushOutbox();
    const b = await view(stub, booked.token.id);
    expect([b.state, b.endReason]).toEqual(["EXPIRED", "validity"]);
    expect((await paymentRow(booked.order))?.status).toBe("forfeited");
  });

  it("PRI-09: cancel a BOOKED pass → refund at the business's % (default 50); after check-in no refund", async () => {
    const { stub, queueId, businessId } = await seedQueue({ settings: ON });
    const b = await pass(stub, { checkIn: false });
    await seedPayment(queueId, businessId, b.order, 10000);
    const c = must(await stub.cancel(b.token.id, b.userId));
    expect([c.refund, c.refundPct, c.token.state]).toEqual([
      true,
      50,
      "CANCELLED",
    ]);
    await stub.flushOutbox();
    expect(await paymentRow(b.order)).toMatchObject({
      status: "refund_due",
      refund_paise: 5000,
    });
    const inLine = await pass(stub);
    const c2 = must(await stub.cancel(inLine.token.id, inLine.userId));
    expect([c2.refund, c2.refundPct]).toEqual([false, 0]);
  });

  it("business cancel (deactivate / archive): BOOKED passes are refunded in full", async () => {
    const { stub, queueId, businessId } = await seedQueue({ settings: ON });
    const b = await pass(stub, { checkIn: false });
    await seedPayment(queueId, businessId, b.order, 10000);
    const r = must(await stub.close({ business: true }));
    expect(r.paidTokens).toEqual([
      { tokenId: b.token.id, orderId: b.order, action: "refund" },
    ]);
    await stub.flushOutbox();
    expect(await paymentRow(b.order)).toMatchObject({
      status: "refund_due",
      refund_paise: 10000,
    });
  });

  it("PAY-07: a reservation cancelled ≥ cancelWindowMin before its estimated call is refunded; later it is not", async () => {
    const { stub, queueId, businessId } = await seedQueue({
      settings: { cancelWindowMin: 15, serviceMinutesHint: 10 },
    });
    for (let i = 0; i < 4; i++) await join(stub);
    const far = await reserve(stub); // ~50 min away
    await seedPayment(queueId, businessId, far.order);
    const c = must(await stub.cancel(far.token.id, far.userId));
    expect(c.refund).toBe(true);
    const near = await seedQueue({
      settings: { cancelWindowMin: 15, serviceMinutesHint: 5 },
    });
    const n = await reserve(near.stub); // next in line
    const c2 = must(await near.stub.cancel(n.token.id, n.userId));
    expect(c2.refund).toBe(false);
  });

  it("TokenView.cancelRefundPct tells the refund a cancel would give, before it is made", async () => {
    const { stub } = await seedQueue({
      settings: {
        ...ON,
        cancelWindowMin: 15,
        serviceMinutesHint: 10,
        priorityCancelRefundPct: 40,
      },
    });
    const free = await join(stub);
    expect(free.cancelRefundPct).toBeNull();
    for (let i = 0; i < 3; i++) await join(stub);
    const far = await reserve(stub); // ~40 min away: inside the refund window
    expect(far.token.cancelRefundPct).toBe(100);
    const booked = await pass(stub, { checkIn: false });
    expect(booked.token.cancelRefundPct).toBe(40);
    const inLine = await pass(stub);
    expect(inLine.token.cancelRefundPct).toBe(0);
    // The view says what the cancel then does.
    const c = must(await stub.cancel(booked.token.id, booked.userId));
    expect([c.refund, c.refundPct]).toEqual([true, 40]);
    expect(c.token.cancelRefundPct).toBeNull();
  });
});
