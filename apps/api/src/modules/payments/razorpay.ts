/**
 * Razorpay HTTP API (test mode in v1; architecture doc §10). Every call goes
 * through `RazorpayTransport`, injectable like `pushOverride`, so tests never
 * touch the network. Secrets come from the Worker env (§17) and are never
 * logged; errors carry Razorpay's status and error code only.
 */

const API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 10_000;

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt?: string | null;
  status: string;
}

export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  /** `pending`, `processed` or `failed`. */
  status: string;
  receipt?: string | null;
  notes?: Record<string, string> | unknown[];
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  /** `created`, `authorized`, `captured`, `refunded`, `failed`. */
  status: string;
  captured?: boolean;
  created_at?: number;
}

export interface RazorpayTransport {
  createOrder(input: {
    amount: number;
    currency: "INR";
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrder>;
  /** Refunds `amount` paise of a captured payment. `receipt` = our idempotency marker. */
  createRefund(
    paymentId: string,
    input: { amount: number; receipt: string; notes: Record<string, string> },
  ): Promise<RazorpayRefund>;
  listRefunds(paymentId: string): Promise<RazorpayRefund[]>;
  /** Payments created in [fromSec, toSec] (unix seconds), one page. */
  listPayments(input: {
    fromSec: number;
    toSec: number;
    count: number;
    skip: number;
  }): Promise<RazorpayPayment[]>;
  /** Payments made against one order (every attempt, any status). */
  fetchOrderPayments(orderId: string): Promise<RazorpayPayment[]>;
  /** One payment: its status, amount and order. */
  fetchPayment(paymentId: string): Promise<RazorpayPayment>;
  /**
   * Captures an `authorized` payment (needed when the account's auto-capture
   * is off). Razorpay answers 400 when it is already captured.
   */
  capturePayment(
    paymentId: string,
    input: { amount: number; currency: "INR" },
  ): Promise<RazorpayPayment>;
}

export class RazorpayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`razorpay http ${status}${code ? ` ${code}` : ""}`);
    this.name = "RazorpayError";
  }
}

export interface RazorpayEnv {
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
}

/** Basic-auth HTTP transport against the Razorpay API. */
export function httpTransport(
  keyId: string,
  keySecret: string,
): RazorpayTransport {
  const auth = `Basic ${btoa(`${keyId}:${keySecret}`)}`;

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: auth,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      let code: string | null = null;
      try {
        const err = (await res.json()) as { error?: { code?: string } };
        code = err.error?.code ?? null;
      } catch {
        // not JSON
      }
      throw new RazorpayError(res.status, code);
    }
    return (await res.json()) as T;
  }

  return {
    createOrder: (input) => call<RazorpayOrder>("POST", "/orders", input),
    createRefund: (paymentId, input) =>
      call<RazorpayRefund>(
        "POST",
        `/payments/${encodeURIComponent(paymentId)}/refund`,
        { ...input, speed: "normal" },
      ),
    listRefunds: async (paymentId) =>
      (
        await call<{ items: RazorpayRefund[] }>(
          "GET",
          `/payments/${encodeURIComponent(paymentId)}/refunds`,
        )
      ).items,
    listPayments: async ({ fromSec, toSec, count, skip }) =>
      (
        await call<{ items: RazorpayPayment[] }>(
          "GET",
          `/payments?from=${fromSec}&to=${toSec}&count=${count}&skip=${skip}`,
        )
      ).items,
    fetchOrderPayments: async (orderId) =>
      (
        await call<{ items: RazorpayPayment[] }>(
          "GET",
          `/orders/${encodeURIComponent(orderId)}/payments`,
        )
      ).items,
    fetchPayment: (paymentId) =>
      call<RazorpayPayment>(
        "GET",
        `/payments/${encodeURIComponent(paymentId)}`,
      ),
    capturePayment: (paymentId, input) =>
      call<RazorpayPayment>(
        "POST",
        `/payments/${encodeURIComponent(paymentId)}/capture`,
        input,
      ),
  };
}

/** Process-wide override (tests only), like `pushOverride`. */
export const razorpayOverride: { transport: RazorpayTransport | null } = {
  transport: null,
};

/** Thrown when the Razorpay secrets are missing (a config error → 500). */
export class PaymentsConfigError extends Error {
  constructor(what: string) {
    super(`payments not configured: ${what} missing`);
    this.name = "PaymentsConfigError";
  }
}

export function razorpayKeyId(env: RazorpayEnv): string {
  if (!env.RAZORPAY_KEY_ID) throw new PaymentsConfigError("RAZORPAY_KEY_ID");
  return env.RAZORPAY_KEY_ID;
}

export function razorpayKeySecret(env: RazorpayEnv): string {
  if (!env.RAZORPAY_KEY_SECRET) {
    throw new PaymentsConfigError("RAZORPAY_KEY_SECRET");
  }
  return env.RAZORPAY_KEY_SECRET;
}

export function razorpayWebhookSecret(env: RazorpayEnv): string {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new PaymentsConfigError("RAZORPAY_WEBHOOK_SECRET");
  }
  return env.RAZORPAY_WEBHOOK_SECRET;
}

/** The transport for this env: the test override, else HTTP with the env's keys. */
export function razorpayTransport(env: RazorpayEnv): RazorpayTransport {
  if (razorpayOverride.transport) return razorpayOverride.transport;
  return httpTransport(razorpayKeyId(env), razorpayKeySecret(env));
}
