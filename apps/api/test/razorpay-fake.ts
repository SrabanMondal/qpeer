import {
  RazorpayError,
  type RazorpayPayment,
  type RazorpayRefund,
  type RazorpayTransport,
} from "../src/modules/payments/razorpay";

/**
 * A recording Razorpay (no network) that keeps payments and refunds like the
 * real one: a payment must exist to be fetched, captured or refunded; only
 * an `authorized` payment can be captured; refunds never exceed the captured
 * amount. Failure switches simulate outages.
 */
export function fakeRazorpay() {
  const orders: { id: string; amount: number; receipt: string }[] = [];
  const refunds: RazorpayRefund[] = [];
  /** Every payment attempt Razorpay knows, by id. */
  const payments = new Map<string, RazorpayPayment>();
  /** Extra entries for `listPayments` (older tests push here). */
  const captured: RazorpayPayment[] = [];
  const calls = { capture: 0, createRefund: 0, fetchPayment: 0 };
  let failRefunds = 0;
  let refundsComeBackFailed = 0;
  let failFetches = 0;
  let seq = 0;

  const find = (id: string) =>
    payments.get(id) ?? captured.find((p) => p.id === id);

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
      calls.createRefund++;
      if (failRefunds > 0) {
        failRefunds--;
        throw new RazorpayError(503, "SERVER_ERROR");
      }
      const p = find(paymentId);
      if (!p || (p.status !== "captured" && p.status !== "refunded")) {
        throw new RazorpayError(400, "BAD_REQUEST_ERROR");
      }
      const live = refunds
        .filter((r) => r.payment_id === paymentId && r.status !== "failed")
        .reduce((s, r) => s + r.amount, 0);
      if (!Number.isInteger(i.amount) || live + i.amount > p.amount) {
        throw new RazorpayError(400, "BAD_REQUEST_ERROR");
      }
      const r: RazorpayRefund = {
        id: `rfnd_${crypto.randomUUID().slice(0, 14)}`,
        payment_id: paymentId,
        amount: i.amount,
        status: refundsComeBackFailed > 0 ? "failed" : "pending",
        receipt: i.receipt,
      };
      if (refundsComeBackFailed > 0) refundsComeBackFailed--;
      refunds.push(r);
      return { ...r };
    },
    async listRefunds(paymentId) {
      return refunds
        .filter((r) => r.payment_id === paymentId)
        .map((r) => ({ ...r }));
    },
    async listPayments() {
      const all = [...payments.values(), ...captured];
      return all.map((p) => ({ ...p }));
    },
    async fetchOrderPayments(orderId) {
      return [...payments.values(), ...captured]
        .filter((p) => p.order_id === orderId)
        .map((p) => ({ ...p }));
    },
    async fetchPayment(paymentId) {
      calls.fetchPayment++;
      if (failFetches > 0) {
        failFetches--;
        throw new RazorpayError(503, "SERVER_ERROR");
      }
      const p = find(paymentId);
      if (!p) throw new RazorpayError(400, "BAD_REQUEST_ERROR");
      return { ...p };
    },
    async capturePayment(paymentId, i) {
      calls.capture++;
      const p = payments.get(paymentId);
      if (p?.status !== "authorized" || p.amount !== i.amount) {
        throw new RazorpayError(400, "BAD_REQUEST_ERROR");
      }
      p.status = "captured";
      p.captured = true;
      return { ...p };
    },
  };

  return {
    transport,
    orders,
    refunds,
    payments,
    captured,
    calls,
    /** A payment attempt on an order, as Checkout would make it. */
    attempt(
      orderId: string,
      amount: number,
      status: "captured" | "authorized" | "failed" | "created" = "captured",
      id = `pay_${crypto.randomUUID().slice(0, 14)}`,
    ): RazorpayPayment {
      const p: RazorpayPayment = {
        id,
        order_id: orderId,
        amount,
        currency: "INR",
        status,
        captured: status === "captured",
        created_at: 1_800_000_000 + seq++,
      };
      payments.set(id, p);
      return { ...p };
    },
    /** Razorpay reports a refund as failed later (refund.failed). */
    failRefund(id: string) {
      const r = refunds.find((x) => x.id === id);
      if (r) r.status = "failed";
    },
    refundsOf(paymentId: string) {
      return refunds.filter((r) => r.payment_id === paymentId);
    },
    failNextRefunds(n: number) {
      failRefunds = n;
    },
    nextRefundsComeBackFailed(n: number) {
      refundsComeBackFailed = n;
    },
    failNextFetches(n: number) {
      failFetches = n;
    },
  };
}

export type FakeRazorpay = ReturnType<typeof fakeRazorpay>;
