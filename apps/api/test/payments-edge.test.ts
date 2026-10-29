import { env } from "cloudflare:workers";
import {
  BusinessView,
  CancelResponse,
  ConfirmPaymentResponse,
  ConsoleState,
  MyPaymentsResponse,
  OrderResponse,
  QueueView,
  TokenView,
  type WeeklyHours,
} from "@qpeer/shared";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CRON_DAILY, CRON_QUARTER_HOUR, runScheduled } from "../src/cron/jobs";
import { db } from "../src/db/client";
import { hmacSha256Hex } from "../src/lib/hmac";
import { pushOverride } from "../src/modules/notifications/expo-push";
import { razorpayOverride } from "../src/modules/payments/razorpay";
import {
  type PayCtx,
  type PayEnv,
  processRefund,
  REFUND_ALERT_AFTER,
  recoverRecentOrders,
  refundBackoffMs,
  strayId,
} from "../src/modules/payments/service";
import { expectError, expectOk, makeTestApi } from "./helpers";
import { fakePush, JAMMU, MIN, stubFor } from "./queue-helpers";
import { fakeRazorpay } from "./razorpay-fake";

/**
 * Payment edge cases (review of 2026-10-29, G1–G5 + the checks around
 * them). One scenario per test, named "situation → what must be true".
 * Razorpay is the recording fake in `razorpay-fake.ts` (no network).
 */

const KEY_SECRET = "edge-key-secret";
const WEBHOOK_SECRET = "edge-webhook-secret";
const SECRETS = {
  RAZORPAY_KEY_ID: "rzp_test_edge",
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
};
const NEAR = { lat: JAMMU.lat, lng: JAMMU.lng, accuracyM: 20, mocked: false };
const NEVER_OPEN: WeeklyHours = {
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};
const PRIORITY = {
  priorityEnabled: true,
  priorityPerRegular: 2,
  priorityFeePaise: 10000,
};

type Api = Awaited<ReturnType<typeof makeTestApi>>;
let api: Api;
let rzp: ReturnType<typeof fakeRazorpay>;
let owner: string;
let n = 0;
let logs: string[] = [];

beforeAll(async () => {
  api = await makeTestApi({ env: SECRETS });
  owner = await api.token({ sub: "edge-owner" });
  rzp = fakeRazorpay();
  razorpayOverride.transport = rzp.transport;
  pushOverride.transport = fakePush().transport;
});

beforeEach(() => {
  logs = [];
  const keep = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(keep);
  vi.spyOn(console, "error").mockImplementation(keep);
  vi.spyOn(console, "warn").mockImplementation(keep);
});

afterEach(() => {
  vi.restoreAllMocks();
  rzp.failNextRefunds(0);
  rzp.nextRefundsComeBackFailed(0);
  rzp.failNextFetches(0);
});

/** A fresh registered user. */
const user = () => api.token({ sub: `edge-user-${++n}` });

const bindings = () => ({ ...env, ...SECRETS }) as typeof env & PayEnv;
const payCtx = (now = api.clock.now()): PayCtx => ({
  db: db(env.DB),
  env: bindings(),
  now,
});

async function setup(settings: Record<string, unknown> = {}) {
  const biz = await expectOk(
    await api.call("POST", "/v1/businesses", owner, {
      name: "Edge Clinic",
      category: "clinic",
      location: JAMMU,
      hours: NEVER_OPEN,
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
  return queue.id;
}

const order = (
  q: string,
  tok: string,
  body: unknown = { kind: "reservation" },
) => api.call("POST", `/v1/queues/${q}/orders`, tok, body);

async function newOrder(
  q: string,
  tok: string,
  body: unknown = { kind: "reservation" },
) {
  return expectOk(await order(q, tok, body), 201, OrderResponse);
}

async function verify(o: OrderResponse, tok: string, paymentId: string) {
  return api.call("POST", "/v1/payments/verify", tok, {
    orderId: o.orderId,
    paymentId,
    signature: await hmacSha256Hex(KEY_SECRET, `${o.orderId}|${paymentId}`),
  });
}

async function webhook(event: unknown, id?: string) {
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-razorpay-signature": await hmacSha256Hex(WEBHOOK_SECRET, body),
  };
  if (id) headers["x-razorpay-event-id"] = id;
  return api.app.fetch(
    new Request("http://localhost/v1/webhooks/razorpay", {
      method: "POST",
      headers,
      body,
    }),
    bindings(),
  );
}

const paymentEvent = (
  event: string,
  p: { id: string; order_id: string | null; amount: number; status?: string },
) => ({
  event,
  payload: {
    payment: {
      entity: {
        id: p.id,
        order_id: p.order_id,
        amount: p.amount,
        currency: "INR",
        status: p.status,
      },
    },
  },
});

const refundEvent = (event: string, refundId: string) => ({
  event,
  payload: { refund: { entity: { id: refundId } } },
});

interface Row {
  id: string;
  status: string;
  reason: string | null;
  amount_paise: number;
  refund_paise: number | null;
  refund_status: string | null;
  refund_id: string | null;
  refund_attempts: number;
  refund_retry_at: number | null;
  token_id: string | null;
  razorpay_payment_id: string | null;
  user_id: string;
}

async function row(id: string) {
  return env.DB.prepare("SELECT * FROM payments WHERE id = ?")
    .bind(id)
    .first<Row>();
}

async function ledger(paymentId: string) {
  const r = await env.DB.prepare(
    "SELECT kind, amount_paise AS amount FROM ledger_entries WHERE payment_id = ? ORDER BY id",
  )
    .bind(paymentId)
    .all<{ kind: string; amount: number }>();
  return r.results;
}

const sum = (rows: { kind: string; amount: number }[], kind?: string) =>
  rows
    .filter((r) => kind === undefined || r.kind === kind)
    .reduce((s, r) => s + r.amount, 0);

async function ticketsFor(paymentId: string) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tokens WHERE payment_id = ?",
  )
    .bind(paymentId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

const quarter = (now: number) =>
  runScheduled(CRON_QUARTER_HOUR, bindings(), now);

const logged = (event: string) =>
  logs.some((l) => l.includes(`"event":"${event}"`));

// ---------- G1: never allocate for an uncaptured payment ----------

describe("G1 · captured means money", () => {
  it("verify of an authorized payment (auto-capture off) → captured first, then one ticket", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise, "authorized");
    const r = await expectOk(
      await verify(o, tok, a.id),
      200,
      ConfirmPaymentResponse,
    );
    expect(r.payment.status).toBe("allocated");
    expect(r.token?.paid).toBe(true);
    expect(rzp.payments.get(a.id)?.status).toBe("captured");
    expect(rzp.calls.capture).toBeGreaterThanOrEqual(1);
    expect(await ticketsFor(o.paymentId)).toBe(1);
  });

  it("verify with a valid signature of a failed payment → 409, no ticket, no ledger rows", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const f = rzp.attempt(o.orderId, o.amountPaise, "failed");
    const e = await expectError(
      await verify(o, tok, f.id),
      409,
      "invalid_state",
    );
    expect(e.details).toEqual({ paymentStatus: "failed" });
    expect((await row(o.paymentId))?.status).toBe("created");
    expect(await ledger(o.paymentId)).toEqual([]);
    expect(await ticketsFor(o.paymentId)).toBe(0);
  });

  it("verify while Razorpay is unreachable → 502, nothing recorded; the retry makes the ticket", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    rzp.failNextFetches(1);
    await expectError(
      await verify(o, tok, a.id),
      502,
      "payment_provider_error",
    );
    expect((await row(o.paymentId))?.status).toBe("created");
    const r = await expectOk(
      await verify(o, tok, a.id),
      200,
      ConfirmPaymentResponse,
    );
    expect(r.payment.status).toBe("allocated");
  });

  it("webhook payment.authorized → captured and ticket made; the later payment.captured changes nothing", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise, "authorized");
    const w = await webhook(
      paymentEvent("payment.authorized", a),
      `evt_auth_${a.id}`,
    );
    expect(w.status).toBe(200);
    expect((await row(o.paymentId))?.status).toBe("allocated");
    const c = await webhook(
      paymentEvent("payment.captured", { ...a, status: "captured" }),
      `evt_cap_${a.id}`,
    );
    expect(c.status).toBe(200);
    expect(await ticketsFor(o.paymentId)).toBe(1);
    expect((await ledger(o.paymentId)).length).toBe(3);
  });

  it("authorized for an amount other than the order's → never captured, no ticket, error logged", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const before = rzp.calls.capture;
    const a = rzp.attempt(o.orderId, o.amountPaise - 100, "authorized");
    expect(
      (await webhook(paymentEvent("payment.authorized", a), `evt_w_${a.id}`))
        .status,
    ).toBe(200);
    expect(rzp.calls.capture).toBe(before);
    expect((await row(o.paymentId))?.status).toBe("created");
    expect(logged("authorized_amount_mismatch")).toBe(true);
  });
});

// ---------- G2: a second captured payment on one order ----------

describe("G2 · two payments on one order", () => {
  it("UPI retry: two captured payments on one order → one ticket; the second is a duplicate row refunded in full; ledger nets to one fee", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    const b = rzp.attempt(o.orderId, o.amountPaise);
    await expectOk(await verify(o, tok, a.id), 200, ConfirmPaymentResponse);
    expect(
      (await webhook(paymentEvent("payment.captured", b), `evt_${b.id}`))
        .status,
    ).toBe(200);
    const dup = await row(strayId(b.id));
    expect(dup).toMatchObject({
      status: "refunded",
      reason: "duplicate_payment",
      amount_paise: o.amountPaise,
      refund_paise: o.amountPaise,
      razorpay_payment_id: b.id,
      token_id: null,
    });
    expect(rzp.refundsOf(b.id)).toHaveLength(1);
    expect(rzp.refundsOf(b.id)[0].amount).toBe(o.amountPaise);
    expect(rzp.refundsOf(a.id)).toHaveLength(0);
    expect(await ticketsFor(o.paymentId)).toBe(1);
    expect(sum(await ledger(dup?.id ?? ""))).toBe(0);
    expect(sum(await ledger(o.paymentId), "capture")).toBe(o.amountPaise);
    const mine = await expectOk(
      await api.call("GET", "/v1/me/payments", tok),
      200,
      MyPaymentsResponse,
    );
    expect(mine.items.map((p) => p.status).sort()).toEqual([
      "allocated",
      "refunded",
    ]);
    expect(logged("duplicate_payment")).toBe(true);
  });

  it("the duplicate seen again (verify, a webhook with a new event id, daily reconcile) → still exactly one refund", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    const b = rzp.attempt(o.orderId, o.amountPaise);
    await verify(o, tok, a.id);
    const again = await expectOk(
      await verify(o, tok, b.id),
      200,
      ConfirmPaymentResponse,
    );
    // The second payment's verify answers with the order's ticket.
    expect(again.payment.id).toBe(o.paymentId);
    expect(again.token?.paid).toBe(true);
    await webhook(paymentEvent("payment.captured", b), `evt_x1_${b.id}`);
    await webhook(paymentEvent("order.paid", b), `evt_x2_${b.id}`);
    await verify(o, tok, b.id);
    await runScheduled(CRON_DAILY, bindings(), api.clock.now());
    expect(rzp.refundsOf(b.id)).toHaveLength(1);
    expect(rzp.refundsOf(a.id)).toHaveLength(0);
    expect(await ticketsFor(o.paymentId)).toBe(1);
  });

  it("two captured payments confirmed at the same time → one ticket, one capture ledger set, one refund", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    const b = rzp.attempt(o.orderId, o.amountPaise);
    const res = await Promise.all([
      webhook(paymentEvent("payment.captured", a), `evt_p_${a.id}`),
      webhook(paymentEvent("payment.captured", b), `evt_p_${b.id}`),
    ]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    const order = await row(o.paymentId);
    expect(order?.status).toBe("allocated");
    const loser = order?.razorpay_payment_id === a.id ? b : a;
    expect((await row(strayId(loser.id)))?.status).toBe("refunded");
    expect(rzp.refundsOf(loser.id)).toHaveLength(1);
    expect(await ticketsFor(o.paymentId)).toBe(1);
    expect((await ledger(o.paymentId)).length).toBe(3);
  });

  it("concurrent verify + webhook of the same payment → exactly one ticket and one capture ledger set", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    const [v, w] = await Promise.all([
      verify(o, tok, a.id),
      webhook(paymentEvent("payment.captured", a), `evt_c_${a.id}`),
    ]);
    expect(w.status).toBe(200);
    expect(
      (await expectOk(v, 200, ConfirmPaymentResponse)).token,
    ).not.toBeNull();
    expect(await ticketsFor(o.paymentId)).toBe(1);
    expect(await ledger(o.paymentId)).toHaveLength(3);
    expect(rzp.refundsOf(a.id)).toHaveLength(0);
  });
});

// ---------- G3: lost webhook + no verify ----------

describe("G3 · recovery within 15 minutes", () => {
  it("webhook lost and the app never verified → the next 15-min run makes the ticket", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    rzp.attempt(o.orderId, o.amountPaise);
    const res = await quarter(api.clock.now() + 15 * MIN);
    expect(
      (res.recover_orders as { confirmed: number }).confirmed,
    ).toBeGreaterThanOrEqual(1);
    expect((await row(o.paymentId))?.status).toBe("allocated");
    expect(await ticketsFor(o.paymentId)).toBe(1);
  });

  it("an authorized payment found by the 15-min run → captured, then the ticket", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise, "authorized");
    await recoverRecentOrders(payCtx(api.clock.now() + 15 * MIN), 100);
    expect(rzp.payments.get(a.id)?.status).toBe("captured");
    expect((await row(o.paymentId))?.status).toBe("allocated");
  });

  it("order expired (30 min), then the payment captured late → the 15-min run still makes the ticket", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const later = api.clock.now() + 40 * MIN;
    await quarter(later);
    expect((await row(o.paymentId))?.status).toBe("expired");
    rzp.attempt(o.orderId, o.amountPaise);
    await recoverRecentOrders(payCtx(later + 15 * MIN), 100);
    expect((await row(o.paymentId))?.status).toBe("allocated");
  });

  it("order expired, then a late payment.captured webhook → ticket made, not lost", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    await quarter(api.clock.now() + 40 * MIN);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    await webhook(paymentEvent("payment.captured", a), `evt_late_${a.id}`);
    expect((await row(o.paymentId))?.status).toBe("allocated");
  });

  it("a late capture whose ticket can no longer be made (queue closed) → refunded in full, not kept", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    await api.call("POST", `/v1/queues/${q}/close`, owner);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    await recoverRecentOrders(payCtx(api.clock.now() + 15 * MIN), 100);
    expect(await row(o.paymentId)).toMatchObject({
      status: "refunded",
      reason: "queue_closed",
      refund_paise: o.amountPaise,
    });
    expect(rzp.refundsOf(a.id)).toHaveLength(1);
  });

  it("orders older than 2 h are left to the daily reconcile, which still confirms them", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    rzp.attempt(o.orderId, o.amountPaise);
    const late = api.clock.now() + 3 * 60 * MIN;
    await recoverRecentOrders(payCtx(late), 100);
    expect((await row(o.paymentId))?.status).toBe("created");
    await runScheduled(CRON_DAILY, bindings(), late);
    expect((await row(o.paymentId))?.status).toBe("allocated");
  });

  it("webhook for an order we don't know → 200 and logged (no retry storm); picked up once the order is there", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const hidden = `hidden_${o.orderId}`;
    await env.DB.prepare(
      "UPDATE payments SET razorpay_order_id = ? WHERE id = ?",
    )
      .bind(hidden, o.paymentId)
      .run();
    const a = rzp.attempt(o.orderId, o.amountPaise);
    const w = await webhook(
      paymentEvent("payment.captured", a),
      `evt_u_${a.id}`,
    );
    expect(w.status).toBe(200);
    expect(logged("confirm_unknown_order")).toBe(true);
    await env.DB.prepare(
      "UPDATE payments SET razorpay_order_id = ? WHERE id = ?",
    )
      .bind(o.orderId, o.paymentId)
      .run();
    await recoverRecentOrders(payCtx(api.clock.now() + 15 * MIN), 100);
    expect((await row(o.paymentId))?.status).toBe("allocated");
  });

  it("DO made the ticket but the D1 status update failed → the next run completes it without a second ticket", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    const now = api.clock.now();
    // Half-way state: captured in D1 and the ticket made in the DO, but the
    // `allocated` update never landed.
    await env.DB.prepare(
      "UPDATE payments SET status = 'captured', razorpay_payment_id = ?, updated_at = ? WHERE id = ?",
    )
      .bind(a.id, now - 5 * MIN, o.paymentId)
      .run();
    const p = await row(o.paymentId);
    const made = await stubFor(q).allocate({
      method: "remote",
      userId: p?.user_id ?? "",
      cls: "regular",
      paymentOrderId: o.orderId,
      paymentId: o.paymentId,
    });
    expect(made.ok).toBe(true);
    const tokenId = made.ok ? made.value.token.id : "";
    await recoverRecentOrders(payCtx(now), 100);
    expect(await row(o.paymentId)).toMatchObject({
      status: "allocated",
      token_id: tokenId,
    });
    // A late verify answers with the same ticket.
    const r = await expectOk(
      await verify(o, tok, a.id),
      200,
      ConfirmPaymentResponse,
    );
    expect(r.token?.id).toBe(tokenId);
    expect(await ticketsFor(o.paymentId)).toBe(1);
  });
});

// ---------- G4: amount mismatch ----------

describe("G4 · captured amount differs from the order", () => {
  it("captured amount ≠ order amount → no ticket; marked amount_mismatch and the actual amount refunded in full; error logged", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const wrong = o.amountPaise + 550;
    const a = rzp.attempt(o.orderId, wrong);
    const r = await expectOk(
      await verify(o, tok, a.id),
      200,
      ConfirmPaymentResponse,
    );
    expect(r.token).toBeNull();
    expect(r.failure?.code).toBe("invalid_state");
    expect(r.payment).toMatchObject({
      status: "refunded",
      amountPaise: wrong,
      refundPaise: wrong,
    });
    expect((await row(strayId(a.id)))?.reason).toBe("amount_mismatch");
    expect(rzp.refundsOf(a.id).map((x) => x.amount)).toEqual([wrong]);
    expect(sum(await ledger(strayId(a.id)))).toBe(0);
    expect((await row(o.paymentId))?.status).toBe("created");
    expect(await ticketsFor(o.paymentId)).toBe(0);
    expect(
      logs.some(
        (l) => l.includes('"level":"error"') && l.includes("amount_mismatch"),
      ),
    ).toBe(true);
    // The same webhook later changes nothing.
    await webhook(paymentEvent("payment.captured", a), `evt_m_${a.id}`);
    expect(rzp.refundsOf(a.id)).toHaveLength(1);
  });
});

// ---------- G5: pay again when already paid ----------

describe("G5 · no second Checkout for a paid purchase", () => {
  it("order requested again while its payment is captured but unconfirmed (verify and webhook lost) → 409 already_in_queue with the ticket id", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    rzp.attempt(o.orderId, o.amountPaise);
    const e = await expectError(await order(q, tok), 409, "already_in_queue");
    const p = await row(o.paymentId);
    expect(p?.status).toBe("allocated");
    expect(e.details).toMatchObject({ tokenId: p?.token_id });
    expect(rzp.orders.filter((x) => x.receipt === o.paymentId)).toHaveLength(1);
  });

  it("a captured payment stuck without its ticket → the next order request finishes it and answers already_in_queue", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    await env.DB.prepare(
      "UPDATE payments SET status = 'captured', razorpay_payment_id = ? WHERE id = ?",
    )
      .bind(a.id, o.paymentId)
      .run();
    const e = await expectError(await order(q, tok), 409, "already_in_queue");
    const p = await row(o.paymentId);
    expect(p?.status).toBe("allocated");
    expect(e.details).toMatchObject({ tokenId: p?.token_id });
  });

  it("an unpaid order (no paid attempt at Razorpay) → the same order is offered again", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    rzp.attempt(o.orderId, o.amountPaise, "failed");
    const again = await newOrder(q, tok);
    expect(again.orderId).toBe(o.orderId);
  });

  it("Priority Pass already booked → 409 already_in_queue with its tokenId", async () => {
    const q = await setup(PRIORITY);
    const tok = await user();
    const body = { kind: "priority", deviceHash: "e".repeat(64) };
    const o = await newOrder(q, tok, body);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    const r = await expectOk(
      await verify(o, tok, a.id),
      200,
      ConfirmPaymentResponse,
    );
    const e = await expectError(
      await order(q, tok, body),
      409,
      "already_in_queue",
    );
    expect(e.details).toMatchObject({ tokenId: r.token?.id });
  });

  it("Skip ahead already paid for this ticket → 409 already_in_queue with the same tokenId", async () => {
    const q = await setup(PRIORITY);
    const toks: { tok: string; t: TokenView }[] = [];
    for (let i = 0; i < 8; i++) {
      const tok = await user();
      toks.push({
        tok,
        t: await expectOk(
          await api.call("POST", `/v1/queues/${q}/join`, tok, NEAR),
          201,
          TokenView,
        ),
      });
    }
    const last = toks[7];
    const body = { deviceHash: "f".repeat(64) };
    const o = await expectOk(
      await api.call("POST", `/v1/tokens/${last.t.id}/upgrade`, last.tok, body),
      201,
      OrderResponse,
    );
    const a = rzp.attempt(o.orderId, o.amountPaise);
    await expectOk(
      await verify(o, last.tok, a.id),
      200,
      ConfirmPaymentResponse,
    );
    const e = await expectError(
      await api.call("POST", `/v1/tokens/${last.t.id}/upgrade`, last.tok, body),
      409,
      "already_in_queue",
    );
    expect(e.details).toMatchObject({ tokenId: last.t.id });
  });
});

// ---------- retries and refunds ----------

describe("Retries and refunds", () => {
  it("payment.failed, then a retry succeeds on the same order → one ticket", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const f = rzp.attempt(o.orderId, o.amountPaise, "failed");
    await webhook(paymentEvent("payment.failed", f), `evt_f_${f.id}`);
    expect((await row(o.paymentId))?.status).toBe("failed");
    const a = rzp.attempt(o.orderId, o.amountPaise);
    const r = await expectOk(
      await verify(o, tok, a.id),
      200,
      ConfirmPaymentResponse,
    );
    expect(r.payment.status).toBe("allocated");
    expect(await ticketsFor(o.paymentId)).toBe(1);
  });

  it("refund.failed → back to refund_due; the 15-min run makes a new refund; never two live refunds", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    await verify(o, tok, a.id);
    await api.call("POST", `/v1/queues/${q}/close`, owner);
    const first = await row(o.paymentId);
    expect(first?.status).toBe("refunded");
    rzp.failRefund(first?.refund_id ?? "");
    await webhook(
      refundEvent("refund.failed", first?.refund_id ?? ""),
      `evt_rf_${a.id}`,
    );
    expect(await row(o.paymentId)).toMatchObject({
      status: "refund_due",
      refund_status: "failed",
      refund_attempts: 1,
    });
    await quarter(api.clock.now());
    const after = await row(o.paymentId);
    expect(after?.status).toBe("refunded");
    expect(after?.refund_id).not.toBe(first?.refund_id);
    const live = rzp.refundsOf(a.id).filter((r) => r.status !== "failed");
    expect(live).toHaveLength(1);
    expect(live[0].amount).toBe(o.amountPaise);
    // The ledger records the refund once.
    expect(sum(await ledger(o.paymentId), "refund")).toBe(-o.amountPaise);
  });

  it("webhook replay with the same event id → no effect (refund.failed counted once)", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    await verify(o, tok, a.id);
    await api.call("POST", `/v1/queues/${q}/close`, owner);
    const refundId = (await row(o.paymentId))?.refund_id ?? "";
    rzp.failRefund(refundId);
    rzp.failNextRefunds(5);
    const ev = refundEvent("refund.failed", refundId);
    await webhook(ev, `evt_replay_${a.id}`);
    const dup = await webhook(ev, `evt_replay_${a.id}`);
    expect(await dup.json()).toEqual({ ok: true, duplicate: true });
    expect((await row(o.paymentId))?.refund_attempts).toBe(1);
  });

  it("refunds keep failing → backoff grows, no attempt before it is over, refund_stuck logged after N failures", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    await verify(o, tok, a.id);
    rzp.failNextRefunds(100);
    await api.call("POST", `/v1/queues/${q}/close`, owner);
    let t = api.clock.now();
    expect((await row(o.paymentId))?.refund_attempts).toBe(1);
    for (let failures = 2; failures <= REFUND_ALERT_AFTER; failures++) {
      const retryAt = (await row(o.paymentId))?.refund_retry_at ?? 0;
      // Before the backoff is over: no Razorpay call.
      const calls = rzp.calls.createRefund;
      if (retryAt > t) {
        await processRefund(payCtx(retryAt - 1), o.paymentId);
        expect(rzp.calls.createRefund).toBe(calls);
      }
      t = Math.max(t, retryAt);
      await quarter(t);
      const p = await row(o.paymentId);
      expect(p?.refund_attempts).toBe(failures);
      expect(p?.refund_retry_at).toBe(t + refundBackoffMs(failures));
    }
    expect(logged("refund_stuck")).toBe(true);
    expect((await row(o.paymentId))?.status).toBe("refund_due");
    rzp.failNextRefunds(0);
    await quarter((await row(o.paymentId))?.refund_retry_at ?? t);
    expect((await row(o.paymentId))?.status).toBe("refunded");
    expect(rzp.refundsOf(a.id)).toHaveLength(1);
  });

  it("two refund attempts at the same time → one Razorpay refund", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    await verify(o, tok, a.id);
    await env.DB.prepare(
      "UPDATE payments SET status = 'refund_due', refund_paise = amount_paise, reason = 'test' WHERE id = ?",
    )
      .bind(o.paymentId)
      .run();
    const ctx = payCtx();
    await Promise.all([
      processRefund(ctx, o.paymentId),
      processRefund(ctx, o.paymentId),
      processRefund(ctx, o.paymentId),
    ]);
    await processRefund(payCtx(api.clock.now() + 5 * MIN), o.paymentId);
    expect(rzp.refundsOf(a.id)).toHaveLength(1);
    expect((await row(o.paymentId))?.status).toBe("refunded");
  });

  it("a refund asked for more than captured, or after an earlier refund by hand → capped at what is left", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    await verify(o, tok, a.id);
    // A refund made by hand in the Razorpay dashboard (no receipt of ours).
    await rzp.transport.createRefund(a.id, {
      amount: 500,
      receipt: "manual",
      notes: {},
    });
    await env.DB.prepare(
      "UPDATE payments SET status = 'refund_due', refund_paise = ?, reason = 'test' WHERE id = ?",
    )
      .bind(o.amountPaise * 2, o.paymentId)
      .run();
    expect(await processRefund(payCtx(), o.paymentId)).toBe(true);
    const total = rzp.refundsOf(a.id).reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(o.amountPaise);
    expect((await row(o.paymentId))?.refund_paise).toBe(o.amountPaise - 500);
    expect(logged("refund_capped")).toBe(true);
  });

  it("partial % refund of an odd fee → refund and reversed shares add up exactly; net shares = fee − refund", async () => {
    const q = await setup({
      ...PRIORITY,
      priorityFeePaise: 9999,
      priorityCancelRefundPct: 33,
    });
    const tok = await user();
    const o = await newOrder(q, tok, {
      kind: "priority",
      deviceHash: "9".repeat(64),
    });
    const a = rzp.attempt(o.orderId, o.amountPaise);
    const r = await expectOk(
      await verify(o, tok, a.id),
      200,
      ConfirmPaymentResponse,
    );
    const c = await expectOk(
      await api.call("POST", `/v1/tokens/${r.token?.id}/cancel`, tok),
      200,
      CancelResponse,
    );
    expect(c.refundPct).toBe(33);
    const p = await row(o.paymentId);
    expect(p?.refund_paise).toBe(Math.floor((9999 * 33) / 100));
    const l = await ledger(o.paymentId);
    const refunded = p?.refund_paise ?? 0;
    expect(sum(l, "refund")).toBe(-refunded);
    expect(sum(l.filter((x) => x.amount < 0 && x.kind !== "refund"))).toBe(
      -refunded,
    );
    expect(sum(l, "business_share") + sum(l, "platform_share")).toBe(
      9999 - refunded,
    );
    expect(rzp.refundsOf(a.id).map((x) => x.amount)).toEqual([refunded]);
  });
});

// ---------- logging ----------

describe("Logs", () => {
  it("verify, webhook and refund logs carry ids and codes only → no signature, raw body or bearer token", async () => {
    const q = await setup();
    const tok = await user();
    const o = await newOrder(q, tok);
    const a = rzp.attempt(o.orderId, o.amountPaise);
    const b = rzp.attempt(o.orderId, o.amountPaise);
    const sig = await hmacSha256Hex(KEY_SECRET, `${o.orderId}|${a.id}`);
    await verify(o, tok, a.id);
    const ev = paymentEvent("payment.captured", b);
    const body = JSON.stringify(ev);
    const whSig = await hmacSha256Hex(WEBHOOK_SECRET, body);
    await webhook(ev, `evt_log_${b.id}`);
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(l).not.toContain(sig);
      expect(l).not.toContain(whSig);
      expect(l).not.toContain(body);
      expect(l).not.toContain(tok);
      expect(l).not.toContain(KEY_SECRET);
      expect(l).not.toContain(WEBHOOK_SECRET);
    }
  });
});
