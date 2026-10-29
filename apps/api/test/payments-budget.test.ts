import { env } from "cloudflare:workers";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  CRON_CALL_BUDGET,
  CRON_QUARTER_HOUR,
  RECONCILE_RESERVE,
  runScheduled,
} from "../src/cron/jobs";
import { BudgetSpent, CallBudget } from "../src/lib/call-budget";
import { pushOverride } from "../src/modules/notifications/expo-push";
import {
  type RazorpayTransport,
  razorpayOverride,
} from "../src/modules/payments/razorpay";
import type { PayEnv } from "../src/modules/payments/service";
import { fakePush } from "./queue-helpers";
import { fakeRazorpay } from "./razorpay-fake";

/**
 * One scheduled run makes at most `CRON_CALL_BUDGET` outbound payment calls
 * (Workers free plan: 50 external subrequests per invocation, INC-064). Work
 * it can't pay for is left for the next run. Rows are written straight into
 * D1 (no queue needed): refunds and order lookups touch only Razorpay.
 */

const SECRETS = {
  RAZORPAY_KEY_ID: "rzp_test_budget",
  RAZORPAY_KEY_SECRET: "budget-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "budget-webhook-secret",
};
const MIN = 60_000;
const FEE = 2000;
/** A quarter-hour run that is neither on the hour nor the daily one. */
const T0 = Date.UTC(2026, 9, 30, 10, 15);
/** The 21:30 UTC run: quarter-hour jobs + the daily reconcile. */
const T_DAILY = Date.UTC(2026, 9, 31, 21, 30);

let rzp: ReturnType<typeof fakeRazorpay>;
let calls = 0;
let pushes = 0;
let logs: string[] = [];
let seq = 0;

/** Counts every call that would reach Razorpay. */
function counting(t: RazorpayTransport): RazorpayTransport {
  const c =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    (...a: A) => {
      calls++;
      return fn(...a);
    };
  return {
    createOrder: c(t.createOrder),
    createRefund: c(t.createRefund),
    listRefunds: c(t.listRefunds),
    listPayments: c(t.listPayments),
    fetchOrderPayments: c(t.fetchOrderPayments),
    fetchPayment: c(t.fetchPayment),
    capturePayment: c(t.capturePayment),
  };
}

beforeAll(() => {
  const push = fakePush();
  pushOverride.transport = {
    send: (m) => {
      pushes++;
      return push.transport.send(m);
    },
    getReceipts: (ids) => push.transport.getReceipts(ids),
  };
});

afterAll(() => {
  razorpayOverride.transport = null;
  pushOverride.transport = null;
});

beforeEach(async () => {
  rzp = fakeRazorpay();
  razorpayOverride.transport = counting(rzp.transport);
  calls = 0;
  pushes = 0;
  logs = [];
  const keep = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(keep);
  vi.spyOn(console, "error").mockImplementation(keep);
  await env.DB.prepare("DELETE FROM payments").run();
  await env.DB.prepare("DELETE FROM ledger_entries").run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const bindings = () => ({ ...env, ...SECRETS }) as typeof env & PayEnv;

/** Spend of one run: Razorpay calls plus pushes actually sent. */
async function run(now: number) {
  calls = 0;
  pushes = 0;
  logs = [];
  const res = await runScheduled(CRON_QUARTER_HOUR, bindings(), now);
  return { res, spent: calls + pushes };
}

async function insert(p: {
  status: string;
  orderId: string;
  razorpayPaymentId?: string | null;
  amount?: number;
  createdAt: number;
}): Promise<string> {
  const id = `budget_${++seq}`;
  const amount = p.amount ?? FEE;
  await env.DB.prepare(
    `INSERT INTO payments (id, user_id, queue_id, business_id, token_id, kind,
       amount_paise, business_share_pct, device_hash, razorpay_order_id,
       razorpay_payment_id, status, refund_paise, reason, expires_at,
       created_at, updated_at)
     VALUES (?, ?, 'budget-queue', 'budget-biz', NULL, 'reservation', ?, 70, NULL,
       ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      `budget-user-${seq}`,
      amount,
      p.orderId,
      p.razorpayPaymentId ?? null,
      p.status,
      p.status === "refund_due" ? amount : null,
      p.status === "refund_due" ? "queue_closed" : null,
      p.createdAt + 30 * MIN,
      p.createdAt,
      p.createdAt,
    )
    .run();
  return id;
}

/** `n` captured payments waiting for their refund (each: 2 calls + 1 push). */
async function refundsDue(n: number, at: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const orderId = `order_rd_${seq}_${i}`;
    const a = rzp.attempt(orderId, FEE);
    ids.push(
      await insert({
        status: "refund_due",
        orderId,
        razorpayPaymentId: a.id,
        createdAt: at - 60 * MIN,
      }),
    );
  }
  return ids;
}

/**
 * `n` unpaid orders made 5 min before `at` (each costs one lookup per run;
 * they expire 25 min after `at`).
 */
async function openOrders(n: number, at: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(
      await insert({
        status: "created",
        orderId: `order_open_${seq}_${i}`,
        createdAt: at - 5 * MIN - i,
      }),
    );
  }
  return ids;
}

async function statusCount(status: string): Promise<number> {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM payments WHERE status = ?",
  )
    .bind(status)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

async function checkedSince(ids: string[], at: number): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const r = await env.DB.prepare(
      "SELECT updated_at FROM payments WHERE id = ?",
    )
      .bind(id)
      .first<{ updated_at: number }>();
    if ((r?.updated_at ?? 0) >= at) n++;
  }
  return n;
}

const budgetLines = () =>
  logs.filter((l) => l.includes('"event":"call_budget_used_up"'));

describe("CallBudget", () => {
  it("counts calls, refuses past the limit, and a child spends from its parent", () => {
    const b = new CallBudget(5);
    const c = b.child(3);
    c.take();
    c.take();
    b.take();
    expect([b.spent, c.spent, b.left, c.left]).toEqual([3, 2, 2, 1]);
    c.take();
    expect(() => c.take()).toThrow(BudgetSpent);
    expect(c.tryTake()).toBe(false);
    b.take();
    expect(b.left).toBe(0);
    expect(() => b.take()).toThrow(BudgetSpent);
  });
});

describe("call budget per scheduled run (INC-064)", () => {
  it("more due work than the budget → at most the budget per run, one info line, no errors; the next runs finish the rest", async () => {
    const refunds = await refundsDue(30, T0);
    const open = await openOrders(20, T0);

    const first = await run(T0);
    expect(first.spent).toBeLessThanOrEqual(CRON_CALL_BUDGET);
    // Recover lost payments first: 15 lookups (its own limit), then refunds.
    expect(first.res.recover_orders).toMatchObject({ checked: 15 });
    const r1 = first.res.refunds as { refunded: number; deferred: number };
    expect(r1.refunded).toBeGreaterThan(0);
    expect(r1.deferred).toBeGreaterThan(0);
    expect(budgetLines()).toHaveLength(1);
    expect(budgetLines()[0]).toContain('"level":"info"');
    expect(logs.some((l) => l.includes('"level":"error"'))).toBe(false);
    // Deferred refunds were not counted as failures.
    const fails = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM payments WHERE refund_attempts > 0",
    ).first<{ n: number }>();
    expect(fails?.n).toBe(0);
    expect(await checkedSince(open, T0)).toBe(15);

    // The next run continues where it stopped: the 5 orders not asked about
    // yet come first, and more refunds are made, again within the budget.
    const second = await run(T0 + 15 * MIN);
    expect(second.spent).toBeLessThanOrEqual(CRON_CALL_BUDGET);
    expect(await checkedSince(open, T0)).toBe(open.length);
    expect(
      (second.res.refunds as { refunded: number }).refunded,
    ).toBeGreaterThan(0);

    let now = T0 + 15 * MIN;
    for (let i = 0; i < 6 && (await statusCount("refund_due")) > 0; i++) {
      now += 15 * MIN;
      const next = await run(now);
      expect(next.spent).toBeLessThanOrEqual(CRON_CALL_BUDGET);
    }
    expect(await statusCount("refund_due")).toBe(0);
    expect(await statusCount("refunded")).toBe(refunds.length);
    for (const id of refunds) {
      const r = await env.DB.prepare(
        "SELECT razorpay_payment_id AS p FROM payments WHERE id = ?",
      )
        .bind(id)
        .first<{ p: string }>();
      expect(rzp.refundsOf(r?.p ?? "")).toHaveLength(1);
    }
  });

  it("the 21:30 run (quarter-hour jobs + reconcile) stays within the budget and still leaves reconcile its scan", async () => {
    await refundsDue(30, T_DAILY);
    await openOrders(20, T_DAILY);
    // Two payments Razorpay captured for the wrong amount on orders older
    // than 2 h: only the daily scan finds them (strays, refunded in full).
    for (let i = 0; i < 2; i++) {
      const orderId = `order_old_${i}`;
      await insert({
        status: "created",
        orderId,
        createdAt: T_DAILY - 5 * 60 * MIN,
      });
      rzp.attempt(orderId, FEE + 100);
    }

    const { res, spent } = await run(T_DAILY);
    expect(spent).toBeLessThanOrEqual(CRON_CALL_BUDGET);
    const rec = res.reconcile as {
      scanComplete: boolean;
      mismatches: number;
    };
    expect(rec.scanComplete).toBe(true);
    expect(rec.mismatches).toBe(2);
    expect(await statusCount("refunded")).toBeGreaterThanOrEqual(2);
    const strays = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM payments WHERE reason = 'amount_mismatch' AND status = 'refunded'",
    ).first<{ n: number }>();
    expect(strays?.n).toBe(2);
    expect(budgetLines()).toHaveLength(1);
    expect(
      logs.some(
        (l) => l.includes('"level":"error"') && !l.includes("amount_mismatch"),
      ),
    ).toBe(false);
    expect(RECONCILE_RESERVE).toBeLessThan(CRON_CALL_BUDGET);
  });

  it("a run with little work makes every call and logs no budget line", async () => {
    await refundsDue(3, T0);
    await openOrders(2, T0);
    const { res, spent } = await run(T0);
    expect(spent).toBeLessThanOrEqual(CRON_CALL_BUDGET);
    expect(res.refunds).toMatchObject({ refunded: 3, deferred: 0 });
    expect(budgetLines()).toHaveLength(0);
  });
});
