import type { OrderResponse } from "@qpeer/shared";

/**
 * Razorpay Checkout (`react-native-razorpay`, test mode in v1). The app only
 * passes what the server returned with the order (public key id + order id);
 * no key is bundled. Plain autolinked native module, no config plugin: it is
 * in every build made from this package.json.
 */

type SuccessData = {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
};

type ErrorData = { code?: number; description?: string };

type CheckoutModule = {
  open: (options: Record<string, unknown>) => Promise<SuccessData>;
};

export type CheckoutResult =
  | {
      kind: "success";
      orderId: string;
      paymentId: string;
      signature: string;
    }
  /** The customer closed Checkout (back / cancel). Nothing was charged. */
  | { kind: "dismissed" }
  | { kind: "failed"; message: string }
  /** This build has no Razorpay native module. */
  | { kind: "unavailable" };

let cached: CheckoutModule | null | undefined;

function checkoutModule(): CheckoutModule | null {
  if (cached !== undefined) return cached;
  try {
    // Lazy: a build without the native module still starts.
    const mod = require("react-native-razorpay") as {
      default?: CheckoutModule;
    } & Partial<CheckoutModule>;
    cached = mod.default ?? (mod.open ? (mod as CheckoutModule) : null);
  } catch {
    cached = null;
  }
  return cached;
}

/** Razorpay Android: `Checkout.PAYMENT_CANCELED` is 0; the description says "cancel" too. */
function isDismissal(e: ErrorData): boolean {
  if (e.code === 0) return true;
  return /cancel/i.test(e.description ?? "");
}

/** Razorpay's description is sometimes a JSON string with `error.description`. */
function errorMessage(e: ErrorData): string {
  const raw = e.description ?? "";
  try {
    const parsed = JSON.parse(raw) as {
      error?: { description?: string; reason?: string };
    };
    const d = parsed.error?.description;
    if (d) return d;
  } catch {
    // Plain text.
  }
  return raw || "The payment did not go through.";
}

/** Opens Razorpay Checkout for an order made on the server. */
export async function openCheckout(
  order: OrderResponse,
  prefill: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  },
  brandColor: string,
): Promise<CheckoutResult> {
  const mod = checkoutModule();
  if (!mod) return { kind: "unavailable" };
  const description =
    order.kind === "reservation"
      ? `Reservation · ${order.queueName}`
      : order.kind === "priority"
        ? `Priority Pass · ${order.queueName}`
        : `Skip ahead · ${order.queueName}`;
  try {
    const data = await mod.open({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: order.currency,
      name: order.businessName,
      description,
      prefill: {
        name: prefill.name ?? undefined,
        email: prefill.email ?? undefined,
        contact: prefill.phone ?? undefined,
      },
      theme: { color: brandColor },
    });
    // An empty payment id or signature can't be verified: the caller then
    // waits for the webhook instead (polls the payment).
    return {
      kind: "success",
      orderId: data?.razorpay_order_id ?? order.orderId,
      paymentId: data?.razorpay_payment_id ?? "",
      signature: data?.razorpay_signature ?? "",
    };
  } catch (e) {
    if (e instanceof TypeError) return { kind: "unavailable" };
    const err = (typeof e === "object" && e !== null ? e : {}) as ErrorData;
    if (isDismissal(err)) return { kind: "dismissed" };
    return { kind: "failed", message: errorMessage(err) };
  }
}
