import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  BusinessPaymentsResponse,
  BusinessView,
  CancelResponse,
  ConfirmPaymentResponse,
  ConsoleState,
  MyPaymentsResponse,
  MyTokensResponse,
  OrderResponse,
  PriorityPreview,
  parseTicket,
  QueueInfoResponse,
  QueueView,
  TokenView,
  ticketSigningInput,
  type WeeklyHours,
} from "@qpeer/shared";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CRON_DAILY, CRON_QUARTER_HOUR, runScheduled } from "../src/cron/jobs";
import { hmacSha256Hex } from "../src/lib/hmac";
import { ticketPayload } from "../src/lib/ticket-sign";
import { pushOverride } from "../src/modules/notifications/expo-push";
import {
  type RazorpayPayment,
  type RazorpayRefund,
  type RazorpayTransport,
  razorpayOverride,
} from "../src/modules/payments/razorpay";
import { expectError, expectOk, makeTestApi } from "./helpers";
import { fakePush, JAMMU, MIN, stubFor } from "./queue-helpers";

/**
 * Step 4 payments through the API (PAY-01…15, PRI-02/05/11): Razorpay is a
 * recording fake (no network), signatures are computed with test secrets.
 */

const KEY_SECRET = "test-key-secret";
const WEBHOOK_SECRET = "test-webhook-secret";
const SECRETS = {
  RAZORPAY_KEY_ID: "rzp_test_fake",
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
};
const NEAR = { lat: JAMMU.lat, lng: JAMMU.lng, accuracyM: 20, mocked: false };
const FAR = {
  lat: JAMMU.lat + 0.05,
  lng: JAMMU.lng,
  accuracyM: 20,
  mocked: false,
};
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
/** Business hours that are never open: a manual close is never "early". */
const CLOSED_DAYS: WeeklyHours = {
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};

function fakeRazorpay() {
  const orders: { id: string; amount: number; receipt: string }[] = [];
  const refunds: RazorpayRefund[] = [];
  const captured: RazorpayPayment[] = [];
  let failRefunds = 0;
  const transport: RazorpayTransport = {
    async createOrder(i) {
      const o = {
        id: `order_${crypto.randomUUID().slice(0, 14)}`,
        amount: i.amount,
        receipt: i.receipt,
      };
      orders.push(o);
      return { ...o, currency: "INR", status: "created" };
    },
    async createRefund(paymentId, i) {
      if (failRefunds > 0) {
        failRefunds--;
        throw new Error("simulated razorpay outage");
      }
      const r: RazorpayRefund = {
        id: `rfnd_${crypto.randomUUID().slice(0, 14)}`,
        payment_id: paymentId,
        amount: i.amount,
        status: "pending",
        receipt: i.receipt,
      };
      refunds.push(r);
      return r;
    },
    async listRefunds(paymentId) {
      return refunds.filter((r) => r.payment_id === paymentId);
    },
    async listPayments() {
      return captured;
    },
    async orderPayments(orderId) {
      return captured.filter((p) => p.order_id === orderId);
    },
  };
  return {
    transport,
    orders,
    refunds,
    captured,
    failNextRefunds(n: number) {
      failRefunds = n;
    },
  };
}

type Api = Awaited<ReturnType<typeof makeTestApi>>;
let api: Api;
let rzp: ReturnType<typeof fakeRazorpay>;
let owner: string;
let alice: string;
let bob: string;
let carol: string;
let anon: string;

beforeAll(async () => {
  api = await makeTestApi({ env: SECRETS });
  owner = await api.token({ sub: "pay-owner" });
  alice = await api.token({ sub: "pay-alice", name: "Alice Kumari" });
  bob = await api.token({ sub: "pay-bob" });
  carol = await api.token({ sub: "pay-carol" });
  anon = await api.token({ sub: "pay-anon", anonymous: true });
  rzp = fakeRazorpay();
  razorpayOverride.transport = rzp.transport;
  pushOverride.transport = fakePush().transport;
});

afterEach(() => {
  rzp.failNextRefunds(0);
});

async function setup(settings: Record<string, unknown> = {}) {
  const biz = await expectOk(
    await api.call("POST", "/v1/businesses", owner, {
      name: "Pay Clinic",
      category: "clinic",
      location: JAMMU,
      hours: CLOSED_DAYS,
    }),
    201,
    BusinessView,
  );
  const queue = await expectOk(
    await api.call("POST", `/v1/businesses/${biz.id}/queues`, owner, {
      name: "OPD",
      settings,
    }),
    201,
    QueueView,
  );
  await expectOk(
    await api.call("POST", `/v1/queues/${queue.id}/open`, owner),
    200,
    ConsoleState,
  );
  return { bizId: biz.id, q: queue.id };
}

const sign = (orderId: string, paymentId: string) =>
  hmacSha256Hex(KEY_SECRET, `${orderId}|${paymentId}`);

async function order(q: string, tok: string, body: unknown) {
  return api.call("POST", `/v1/queues/${q}/orders`, tok, body);
}

/** Order + Checkout success + client verify. */
async function buy(
  q: string,
  tok: string,
  body: unknown = { kind: "reservation" },
) {
  const o = await expectOk(await order(q, tok, body), 201, OrderResponse);
  return { o, ...(await pay(o, tok)) };
}

async function pay(o: OrderResponse, tok: string) {
  const paymentId = `pay_${crypto.randomUUID().slice(0, 14)}`;
  const res = await api.call("POST", "/v1/payments/verify", tok, {
    orderId: o.orderId,
    paymentId,
    signature: await sign(o.orderId, paymentId),
  });
  return { paymentId, r: await expectOk(res, 200, ConfirmPaymentResponse) };
}

async function webhook(
  event: unknown,
  opts: { id?: string; sig?: string } = {},
) {
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-razorpay-signature":
      opts.sig ?? (await hmacSha256Hex(WEBHOOK_SECRET, body)),
  };
  if (opts.id) headers["x-razorpay-event-id"] = opts.id;
  return api.app.fetch(
    new Request("http://localhost/v1/webhooks/razorpay", {
      method: "POST",
      headers,
      body,
    }),
    { ...env, ...SECRETS },
  );
}

const captured = (orderId: string, paymentId: string, amount: number) => ({
  event: "payment.captured",
  payload: {
    payment: { entity: { id: paymentId, order_id: orderId, amount } },
  },
});

async function ledger(paymentId: string) {
  const r = await env.DB.prepare(
    "SELECT kind, amount_paise AS amount FROM ledger_entries WHERE payment_id = ? ORDER BY id",
  )
    .bind(paymentId)
    .all<{ kind: string; amount: number }>();
  return r.results;
}

async function payment(id: string) {
  return env.DB.prepare(
    "SELECT status, refund_paise, refund_status, token_id, device_hash FROM payments WHERE id = ?",
  )
    .bind(id)
    .first<{
      status: string;
      refund_paise: number | null;
      refund_status: string | null;
      token_id: string | null;
      device_hash: string | null;
    }>();
}

describe("Remote reservation (PAY-01…07, HLD §6.3)", () => {
  it("PAY-01/03/10: registered only; amount from settings; verify → token; ledger capture 70/30", async () => {
    const { q } = await setup({ reservationFeePaise: 2500 });
    await expectError(
      await order(q, anon, { kind: "reservation" }),
      403,
      "registration_required",
    );
    await expectError(
      await order(q, alice, { kind: "reservation", amountPaise: 1 }),
      400,
      "invalid_input",
    );
    const { o, r } = await buy(q, alice);
    expect(o.amountPaise).toBe(2500);
    expect(o.keyId).toBe("rzp_test_fake");
    expect(o.rules.cancelWindowMin).toBe(15);
    expect(r.failure).toBeNull();
    expect(r.payment.status).toBe("allocated");
    expect(r.token?.method).toBe("remote");
    expect(r.token?.paid).toBe(true);
    expect(rzp.orders.at(-1)).toMatchObject({
      amount: 2500,
      receipt: o.paymentId,
    });
    expect(await ledger(o.paymentId)).toEqual([
      { kind: "capture", amount: 2500 },
      { kind: "business_share", amount: 1750 },
      { kind: "platform_share", amount: 750 },
    ]);
    const d1 = await env.DB.prepare(
      "SELECT payment_id FROM tokens WHERE id = ?",
    )
      .bind(r.token?.id)
      .first<{ payment_id: string }>();
    expect(d1?.payment_id).toBe(o.paymentId);
  });

  it("PAY-03/04: bad signature rejected; verify and webhook (any order, in parallel) make one token", async () => {
    const { q } = await setup();
    const o = await expectOk(
      await order(q, bob, { kind: "reservation" }),
      201,
      OrderResponse,
    );
    await expectError(
      await api.call("POST", "/v1/payments/verify", bob, {
        orderId: o.orderId,
        paymentId: "pay_x",
        signature: "0".repeat(64),
      }),
      400,
      "invalid_input",
    );
    // Someone else's order: 404 even with a valid signature.
    await expectError(
      await api.call("POST", "/v1/payments/verify", carol, {
        orderId: o.orderId,
        paymentId: "pay_y",
        signature: await sign(o.orderId, "pay_y"),
      }),
      404,
      "not_found",
    );
    const paymentId = "pay_parallel1";
    const [v, w] = await Promise.all([
      api.call("POST", "/v1/payments/verify", bob, {
        orderId: o.orderId,
        paymentId,
        signature: await sign(o.orderId, paymentId),
      }),
      webhook(captured(o.orderId, paymentId, o.amountPaise), { id: "evt_p1" }),
    ]);
    expect(w.status).toBe(200);
    const r = await expectOk(v, 200, ConfirmPaymentResponse);
    const again = await pay(o, bob);
    expect(again.r.token?.id).toBe(r.token?.id);
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM tokens WHERE payment_id = ?",
    )
      .bind(o.paymentId)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
    expect((await ledger(o.paymentId)).length).toBe(3);
  });

  it("PAY-04: webhook signature on the raw body; dedupe by event id; payment.failed; unknown events acknowledged", async () => {
    const { q } = await setup();
    const o = await expectOk(
      await order(q, carol, { kind: "reservation" }),
      201,
      OrderResponse,
    );
    expect(
      (await webhook({ event: "payment.failed" }, { sig: "f".repeat(64) }))
        .status,
    ).toBe(400);
    const failed = {
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: "pay_f",
            order_id: o.orderId,
            error_code: "BAD_REQUEST_ERROR",
          },
        },
      },
    };
    expect((await webhook(failed, { id: "evt_f1" })).status).toBe(200);
    expect((await payment(o.paymentId))?.status).toBe("failed");
    const dup = await webhook(failed, { id: "evt_f1" });
    expect(await dup.json()).toEqual({ ok: true, duplicate: true });
    expect(
      (await webhook({ event: "order.notified" }, { id: "evt_x" })).status,
    ).toBe(200);
    // PAY-05: a capture after a failure still makes the ticket.
    const late = await webhook(captured(o.orderId, "pay_late", o.amountPaise), {
      id: "evt_late",
    });
    expect(late.status).toBe(200);
    expect((await payment(o.paymentId))?.status).toBe("allocated");
  });

  it("PAY-06: quota filled between order and capture → automatic full refund + ledger reversal", async () => {
    const { q } = await setup({ walkinQuotaPct: 99, maxSize: 100 });
    // cap = floor(100 × 1 / 100) = 1 remote waiting.
    const o1 = await expectOk(
      await order(q, alice, { kind: "reservation" }),
      201,
      OrderResponse,
    );
    const o2 = await expectOk(
      await order(q, bob, { kind: "reservation" }),
      201,
      OrderResponse,
    );
    await pay(o1, alice);
    const { r } = await pay(o2, bob);
    expect(r.token).toBeNull();
    expect(r.failure?.code).toBe("quota_full");
    expect(r.payment.status).toBe("refunded");
    expect(r.payment.refundPaise).toBe(2000);
    expect(rzp.refunds.at(-1)).toMatchObject({
      amount: 2000,
      receipt: o2.paymentId,
    });
    expect(await ledger(o2.paymentId)).toEqual([
      { kind: "capture", amount: 2000 },
      { kind: "business_share", amount: 1400 },
      { kind: "platform_share", amount: 600 },
      { kind: "refund", amount: -2000 },
      { kind: "business_share", amount: -1400 },
      { kind: "platform_share", amount: -600 },
    ]);
    // Verify again: same answer, no second refund.
    const again = await pay(o2, bob);
    expect(again.r.failure?.code).toBe("quota_full");
    expect(rzp.refunds.filter((x) => x.receipt === o2.paymentId)).toHaveLength(
      1,
    );
  });

  it("PAY-07: cancel inside the window → Refunds API; refund.processed webhook updates the status", async () => {
    const { q } = await setup({ serviceMinutesHint: 30 });
    const { o, r } = await buy(q, carol);
    const c = await expectOk(
      await api.call("POST", `/v1/tokens/${r.token?.id}/cancel`, carol),
      200,
      CancelResponse,
    );
    expect([c.refund, c.refundPct, c.token.state]).toEqual([
      true,
      100,
      "CANCELLED",
    ]);
    const p = await payment(o.paymentId);
    expect(p).toMatchObject({
      status: "refunded",
      refund_paise: 2000,
      refund_status: "pending",
    });
    const refund = rzp.refunds.find((x) => x.receipt === o.paymentId);
    await webhook(
      {
        event: "refund.processed",
        payload: {
          refund: {
            entity: { id: refund?.id, payment_id: refund?.payment_id },
          },
        },
      },
      { id: `evt_${refund?.id}` },
    );
    expect((await payment(o.paymentId))?.refund_status).toBe("processed");
  });

  it("PAY-08/14: no-show → MISSED → never rejoined → close: forfeit recorded, shares stand", async () => {
    const { q } = await setup({ graceMinutes: 1 });
    const { o, r } = await buy(q, alice);
    const tokenId = r.token?.id ?? "";
    await api.call("POST", `/v1/queues/${q}/next`, owner);
    await api.call("POST", `/v1/queues/${q}/tokens/${tokenId}/no-show`, owner);
    const stub = stubFor(q);
    await stub.testAdvanceClock(MIN + 1000);
    await runDurableObjectAlarm(stub);
    const t = await expectOk(
      await api.call("GET", `/v1/tokens/${tokenId}`, alice),
      200,
      TokenView,
    );
    expect(t.state).toBe("MISSED");
    await expectOk(
      await api.call("POST", `/v1/queues/${q}/close`, owner),
      200,
      ConsoleState,
    );
    await stub.flushOutbox();
    expect((await payment(o.paymentId))?.status).toBe("forfeited");
    expect(await ledger(o.paymentId)).toEqual([
      { kind: "capture", amount: 2000 },
      { kind: "business_share", amount: 1400 },
      { kind: "platform_share", amount: 600 },
      { kind: "forfeit", amount: 0 },
    ]);
    // No strike for a paid ticket (C5).
    const s = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM free_lane_strikes WHERE token_id = ?",
    )
      .bind(tokenId)
      .first<{ n: number }>();
    expect(s?.n).toBe(0);
  });

  it("PAY-09: the business closes with paid tokens waiting → refunded in full right away", async () => {
    const { q } = await setup();
    const { o } = await buy(q, bob);
    await expectOk(
      await api.call("POST", `/v1/queues/${q}/close`, owner),
      200,
      ConsoleState,
    );
    expect((await payment(o.paymentId))?.status).toBe("refunded");
  });

  it("auto-close / cron: a refund decided by the DO (and a failed inline refund) is made by the 15-min cron", async () => {
    const { q } = await setup();
    const { o } = await buy(q, carol);
    rzp.failNextRefunds(1);
    await expectOk(
      await api.call("POST", `/v1/queues/${q}/close`, owner),
      200,
      ConsoleState,
    );
    expect((await payment(o.paymentId))?.status).toBe("refund_due");
    const res = await runScheduled(
      CRON_QUARTER_HOUR,
      { ...env, ...SECRETS },
      api.clock.now(),
    );
    expect(
      (res.refunds as { refunded: number }).refunded,
    ).toBeGreaterThanOrEqual(1);
    expect((await payment(o.paymentId))?.status).toBe("refunded");
  });

  it("PAY-11: payment history for the payer and the owner (net shares)", async () => {
    const { q, bizId } = await setup();
    api.clock.t += 60_000; // newest of alice's payments
    const { o } = await buy(q, alice);
    const mine = await expectOk(
      await api.call("GET", "/v1/me/payments?limit=1", alice),
      200,
      MyPaymentsResponse,
    );
    expect(mine.items[0].id).toBe(o.paymentId);
    expect(mine.items[0].businessName).toBe("Pay Clinic");
    expect(mine.nextCursor).not.toBeNull();
    const page2 = await expectOk(
      await api.call(
        "GET",
        `/v1/me/payments?limit=100&cursor=${mine.nextCursor}`,
        alice,
      ),
      200,
      MyPaymentsResponse,
    );
    expect(page2.items.some((p) => p.id === o.paymentId)).toBe(false);
    const biz = await expectOk(
      await api.call("GET", `/v1/businesses/${bizId}/payments`, owner),
      200,
      BusinessPaymentsResponse,
    );
    expect(biz.items[0]).toMatchObject({
      id: o.paymentId,
      businessSharePaise: 1400,
      platformSharePaise: 600,
    });
    await expectError(
      await api.call("GET", `/v1/businesses/${bizId}/payments`, alice),
      404,
      "not_found",
    );
  });

  it("PAY-12: reconciliation confirms a captured payment we never heard about; expires unpaid orders", async () => {
    const { q } = await setup();
    const o = await expectOk(
      await order(q, bob, { kind: "reservation" }),
      201,
      OrderResponse,
    );
    rzp.captured.push({
      id: "pay_recon",
      order_id: o.orderId,
      amount: o.amountPaise,
      currency: "INR",
      status: "captured",
    });
    const stale = await expectOk(
      await order(q, carol, { kind: "reservation" }),
      201,
      OrderResponse,
    );
    const later = api.clock.now() + 31 * MIN;
    const res = await runScheduled(CRON_DAILY, { ...env, ...SECRETS }, later);
    expect(
      (res.reconcile as { expired: number }).expired,
    ).toBeGreaterThanOrEqual(2);
    expect((await payment(o.paymentId))?.status).toBe("allocated");
    expect((await payment(stale.paymentId))?.status).toBe("expired");
    rzp.captured.length = 0;
  });
});

describe("Priority Pass + upgrade (PRI-02, PRI-05, PRI-11, PRI-12)", () => {
  const ON = {
    priorityEnabled: true,
    priorityPerRegular: 2,
    priorityFeePaise: 10000,
  };

  it("PRI-02/03: preview → buy → BOOKED → GPS check-in → P1; off → priority_off", async () => {
    const off = await setup();
    await expectError(
      await order(off.q, alice, { kind: "priority", deviceHash: HASH_A }),
      409,
      "priority_off",
    );
    const { q } = await setup(ON);
    await expectError(
      await order(q, alice, { kind: "priority" }),
      400,
      "invalid_input",
    );
    for (let i = 0; i < 6; i++) {
      const t = await api.token({ sub: `pp-walk-${q}-${i}` });
      await expectOk(
        await api.call("POST", `/v1/queues/${q}/join`, t, NEAR),
        201,
        TokenView,
      );
    }
    const pv = await expectOk(
      await api.call("GET", `/v1/queues/${q}/priority-preview`, anon),
      200,
      PriorityPreview,
    );
    expect(pv.enabled).toBe(true);
    expect(pv.savingMin).toBeGreaterThan(0);
    expect(pv.priorityWait?.lowMs).toBeLessThan(pv.regularWait?.lowMs ?? 0);
    const info = await expectOk(
      await api.call("GET", `/v1/queues/${q}`, anon),
      200,
      QueueInfoResponse,
    );
    expect(info.priority).toMatchObject({
      enabled: true,
      perRegular: 2,
      soldOut: false,
    });
    expect(info.live.priority?.enabled).toBe(true);

    const { o, r } = await buy(q, alice, {
      kind: "priority",
      deviceHash: HASH_A,
    });
    expect(o.rules.cancelRefundPct).toBe(50);
    expect(r.token?.state).toBe("BOOKED");
    expect((await payment(o.paymentId))?.device_hash).toBe(HASH_A);
    const id = r.token?.id ?? "";
    await expectError(
      await api.call("POST", `/v1/tokens/${id}/checkin`, alice, FAR),
      422,
      "too_far",
    );
    await expectError(
      await api.call("POST", `/v1/tokens/${id}/checkin`, alice, {
        ...NEAR,
        mocked: true,
      }),
      422,
      "mock_location",
    );
    await expectError(
      await api.call("POST", `/v1/tokens/${id}/checkin`, bob, NEAR),
      404,
      "not_found",
    );
    const t = await expectOk(
      await api.call("POST", `/v1/tokens/${id}/checkin`, alice, NEAR),
      200,
      TokenView,
    );
    expect([t.state, t.label, t.lane]).toEqual(["WAITING", "P1", "priority"]);
    expect(t.peopleAhead).toBe(2); // waits N = 2 regular calls (credits start at 0)
  });

  it("PRI-12 / C4 / R2: the signed ticket carries the check code, the first name and the last 4 phone digits only", async () => {
    const view = {
      ...(await expectOk(
        await api.call(
          "POST",
          `/v1/queues/${(await setup()).q}/join`,
          carol,
          NEAR,
        ),
        201,
        TokenView,
      )),
    };
    const p = ticketPayload(view, "kid-1", {
      displayName: "Ravi Kumar Sharma",
      phone: "+91 98765 43210",
    });
    expect(p).toMatchObject({ cc: view.checkCode, fn: "Ravi", p4: "3210" });
    const text = `QPT1.${ticketSigningInput({ ...(p as NonNullable<typeof p>), fn: "राज" }).split(".")[1]}.${"A".repeat(86)}`;
    expect(parseTicket(text)?.payload.fn).toBe("राज");
    expect(JSON.stringify(p)).not.toMatch(/Kumar|98765/);
  });

  it("PRI-11: one pass per account and per phone per queue per day (pass_limit); an unpaid order is reused", async () => {
    const { q } = await setup(ON);
    const first = await expectOk(
      await order(q, bob, { kind: "priority", deviceHash: HASH_B }),
      201,
      OrderResponse,
    );
    const same = await expectOk(
      await order(q, bob, { kind: "priority", deviceHash: HASH_B }),
      201,
      OrderResponse,
    );
    expect(same.orderId).toBe(first.orderId);
    await pay(first, bob);
    // Same phone, another account.
    await expectError(
      await order(q, carol, { kind: "priority", deviceHash: HASH_B }),
      409,
      "pass_limit",
    );
    // Same account cancels and tries again the same day.
    const mine = await expectOk(
      await api.call("GET", "/v1/me/tokens", bob),
      200,
      MyTokensResponse,
    );
    const tok = mine.items.find((t) => t.queueId === q);
    expect(tok?.state).toBe("BOOKED");
    await expectOk(
      await api.call("POST", `/v1/tokens/${tok?.id}/cancel`, bob),
      200,
      CancelResponse,
    );
    await expectError(
      await order(q, bob, { kind: "priority", deviceHash: "c".repeat(64) }),
      409,
      "pass_limit",
    );
  });

  it("PRI-09: cancelling a BOOKED pass refunds 50 % with proportional ledger entries", async () => {
    const { q } = await setup(ON);
    const { o, r } = await buy(q, carol, {
      kind: "priority",
      deviceHash: "d".repeat(64),
    });
    const c = await expectOk(
      await api.call("POST", `/v1/tokens/${r.token?.id}/cancel`, carol),
      200,
      CancelResponse,
    );
    expect([c.refund, c.refundPct]).toEqual([true, 50]);
    expect(await payment(o.paymentId)).toMatchObject({
      status: "refunded",
      refund_paise: 5000,
    });
    const l = await ledger(o.paymentId);
    expect(l.filter((x) => x.amount < 0)).toEqual([
      { kind: "refund", amount: -5000 },
      { kind: "business_share", amount: -3500 },
      { kind: "platform_share", amount: -1500 },
    ]);
  });

  it("PRI-05/C2: upgrade order only when it saves enough; confirm moves the same ticket; a ticket called meanwhile is refunded", async () => {
    const { q } = await setup(ON);
    const toks = [];
    for (let i = 0; i < 8; i++) {
      const tok = await api.token({ sub: `up-${q}-${i}` });
      toks.push({
        tok,
        t: await expectOk(
          await api.call("POST", `/v1/queues/${q}/join`, tok, NEAR),
          201,
          TokenView,
        ),
      });
    }
    await expectError(
      await api.call(
        "POST",
        `/v1/tokens/${toks[0].t.id}/upgrade`,
        toks[0].tok,
        { deviceHash: "1".repeat(64) },
      ),
      409,
      "invalid_state",
    );
    const last = toks[7];
    const v = await expectOk(
      await api.call("GET", `/v1/tokens/${last.t.id}`, last.tok),
      200,
      TokenView,
    );
    expect(v.upgrade?.show).toBe(true);
    const o = await expectOk(
      await api.call("POST", `/v1/tokens/${last.t.id}/upgrade`, last.tok, {
        deviceHash: "2".repeat(64),
      }),
      201,
      OrderResponse,
    );
    expect([o.kind, o.tokenId, o.amountPaise]).toEqual([
      "upgrade",
      last.t.id,
      10000,
    ]);
    const { r } = await pay(o, last.tok);
    expect(r.token?.id).toBe(last.t.id);
    expect(r.token?.lane).toBe("priority");

    // Upgrade paid after the ticket left WAITING → full refund.
    const mid = toks[6];
    const o2 = await expectOk(
      await api.call("POST", `/v1/tokens/${mid.t.id}/upgrade`, mid.tok, {
        deviceHash: "3".repeat(64),
      }),
      201,
      OrderResponse,
    );
    await api.call("POST", `/v1/tokens/${mid.t.id}/leave`, mid.tok);
    const late = await pay(o2, mid.tok);
    expect(late.r.failure?.code).toBe("invalid_state");
    expect(late.r.payment.status).toBe("refunded");
  });
});

describe("Missed turn through the API (QUE-23, QUE-29)", () => {
  it("QUE-23: 'I'm here' runs the GPS check; R2: staff rejoin by number + code", async () => {
    const { q } = await setup({ graceMinutes: 1 });
    const t = await expectOk(
      await api.call("POST", `/v1/queues/${q}/join`, alice, NEAR),
      201,
      TokenView,
    );
    const u = await expectOk(
      await api.call("POST", `/v1/queues/${q}/join`, bob, NEAR),
      201,
      TokenView,
    );
    const stub = stubFor(q);
    for (const id of [t.id, u.id]) {
      await api.call("POST", `/v1/queues/${q}/next`, owner);
      await api.call("POST", `/v1/queues/${q}/tokens/${id}/no-show`, owner);
    }
    await stub.testAdvanceClock(MIN + 1000);
    await runDurableObjectAlarm(stub);
    await expectError(
      await api.call("POST", `/v1/tokens/${t.id}/rejoin`, alice, FAR),
      422,
      "too_far",
    );
    await expectError(
      await api.call("POST", `/v1/tokens/${t.id}/rejoin`, alice, {
        ...NEAR,
        mocked: true,
      }),
      422,
      "mock_location",
    );
    const back = await expectOk(
      await api.call("POST", `/v1/tokens/${t.id}/rejoin`, alice, NEAR),
      200,
      TokenView,
    );
    expect([back.state, back.rejoined]).toEqual(["WAITING", true]);
    await expectError(
      await api.call("POST", `/v1/tokens/${t.id}/rejoin`, alice, NEAR),
      409,
      "invalid_state",
    );

    await expectError(
      await api.call("POST", `/v1/queues/${q}/rejoin-for-customer`, owner, {
        label: u.label,
        checkCode: "ZZZZ",
      }),
      404,
      "not_found",
    );
    await expectError(
      await api.call("POST", `/v1/queues/${q}/rejoin-for-customer`, alice, {
        label: u.label,
        checkCode: u.checkCode,
      }),
      404,
      "not_found",
    );
    const r = await api.call(
      "POST",
      `/v1/queues/${q}/rejoin-for-customer`,
      owner,
      {
        label: u.label,
        checkCode: u.checkCode,
      },
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      token: TokenView;
      console: ConsoleState;
    };
    expect(body.token.state).toBe("WAITING");
    // C4: the console (online) shows full names.
    const c = await expectOk(
      await api.call("GET", `/v1/queues/${q}/console`, owner),
      200,
      ConsoleState,
    );
    expect(c.waiting.map((w) => w.holderName)).toContain("Alice Kumari");
  });
});
