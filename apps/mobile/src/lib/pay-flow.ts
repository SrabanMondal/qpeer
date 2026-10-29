import type { OrderResponse, PaymentView, TokenView } from "@qpeer/shared";
import type { Href } from "expo-router";

import { ApiError, isNetworkError } from "@/lib/api/client";
import {
  listMyPayments,
  type PayKind,
  verifyPayment,
} from "@/lib/api/payments";
import { getToken } from "@/lib/api/tokens";
import { messageForCode } from "@/lib/error-messages";
import type { CheckoutResult } from "@/lib/razorpay";

/**
 * After Razorpay Checkout says "paid": confirm on the server (PAY-03). The
 * webhook confirms too (PAY-04), so when the client confirmation fails
 * (network, no signature) the app polls the payment a few times before
 * saying "payment received, confirming".
 */

/** A pay screen link: reservation / pass for a queue, or an upgrade of a ticket. */
export function payHref(p: {
  kind: PayKind;
  queueId: string;
  tokenId?: string;
}): Href {
  const q = new URLSearchParams({ kind: p.kind, queueId: p.queueId });
  if (p.tokenId) q.set("tokenId", p.tokenId);
  // A plain string: the typed-routes file may not list this route yet (INC-050).
  return `/pay?${q.toString()}` as Href;
}

export type PayOutcome =
  /** A ticket was made (or upgraded). */
  | { kind: "ticket"; token: TokenView }
  /** Paid, but no ticket could be made: a full refund was started (PAY-06). */
  | { kind: "refunded"; title: string; message: string }
  /** Paid, the server hasn't confirmed yet (webhook pending). */
  | { kind: "pending" };

const POLLS = 6;
const POLL_EVERY_MS = 3_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Why no ticket was made, in words (the money is always refunded in full). */
function refundedOutcome(code: string | null): PayOutcome {
  const why: Record<string, string> = {
    quota_full: "The last place was taken while you paid.",
    queue_full: "The queue filled up while you paid.",
    queue_closed: "The queue closed while you paid.",
    queue_paused: "The queue was paused while you paid.",
    sold_out: "The last Priority Pass for today was sold while you paid.",
    priority_off: "The business switched the priority lane off while you paid.",
    already_in_queue: "You already have a ticket in this queue.",
    invalid_state: "Your ticket had already moved on (called or ended).",
  };
  return {
    kind: "refunded",
    title: "No ticket could be made",
    message: `${code ? (why[code] ?? messageForCode(code)) : "Something changed while you paid."} Your payment is being refunded in full. Refunds take 5–7 days to reach your account.`,
  };
}

function fromPayment(p: PaymentView): PayOutcome | null {
  if (p.status === "failed") {
    return {
      kind: "refunded",
      title: "The payment failed",
      message: "You were not charged. Try again.",
    };
  }
  if (
    p.tokenId === null &&
    (p.status === "refund_due" || p.status === "refunded")
  ) {
    return refundedOutcome(null);
  }
  return null;
}

async function pollPayment(paymentId: string): Promise<PayOutcome> {
  for (let i = 0; i < POLLS; i++) {
    await sleep(POLL_EVERY_MS);
    try {
      const page = await listMyPayments(undefined, 20);
      const p = page.items.find((x) => x.id === paymentId);
      if (!p) continue;
      if (p.tokenId && p.status !== "created" && p.status !== "captured") {
        return { kind: "ticket", token: await getToken(p.tokenId) };
      }
      const done = fromPayment(p);
      if (done) return done;
    } catch {
      // Offline for a moment: keep trying.
    }
  }
  return { kind: "pending" };
}

/** Verify attempts when Razorpay did not answer the server (502). */
const VERIFY_TRIES = 3;
const VERIFY_RETRY_MS = 2_000;

/**
 * The 409 `invalid_state` verify answers when Razorpay has not captured the
 * payment yet (`details.paymentStatus`, e.g. `authorized` or `created` while
 * a UPI payment settles). Not an error for the user: the webhook or the
 * server's 15-min recovery confirms it, so the app waits for it.
 */
export function isNotCapturedYet(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.status !== 409 || e.code !== "invalid_state") return false;
  const d = e.details;
  return (
    typeof d === "object" &&
    d !== null &&
    typeof (d as { paymentStatus?: unknown }).paymentStatus === "string"
  );
}

/** A 502 `payment_provider_error`: the server could not reach Razorpay; retry. */
function isProviderError(e: unknown): boolean {
  return e instanceof ApiError && e.code === "payment_provider_error";
}

/** Confirms a successful Checkout and returns what to show next. */
export async function confirmCheckout(
  order: OrderResponse,
  result: Extract<CheckoutResult, { kind: "success" }>,
): Promise<PayOutcome> {
  if (result.paymentId && /^[0-9a-f]{64}$/.test(result.signature)) {
    for (let attempt = 1; attempt <= VERIFY_TRIES; attempt++) {
      try {
        const r = await verifyPayment({
          orderId: result.orderId,
          paymentId: result.paymentId,
          signature: result.signature,
        });
        if (r.token) return { kind: "ticket", token: r.token };
        if (r.failure) return refundedOutcome(r.failure.code);
        const done = fromPayment(r.payment);
        if (done) return done;
        break;
      } catch (e) {
        // Razorpay did not answer the server: nothing was recorded, so the
        // same verify is safe to repeat after a short wait.
        if (isProviderError(e) && attempt < VERIFY_TRIES) {
          await sleep(VERIFY_RETRY_MS * attempt);
          continue;
        }
        // Not captured yet (409 + paymentStatus), network, a provider error
        // that persists, or a signature the server can't check: the webhook
        // still confirms a real payment, so wait for it below ("Payment
        // received — confirming").
        if (
          !isNotCapturedYet(e) &&
          !isNetworkError(e) &&
          !(e instanceof ApiError)
        ) {
          throw e;
        }
        break;
      }
    }
  }
  return pollPayment(order.paymentId);
}

/**
 * An order request answered 409 `already_in_queue` with the ticket the user
 * already holds here (one active ticket per person per queue): its id, so
 * the app opens it instead of showing an error. Null for anything else.
 */
export function existingTicketId(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.code !== "already_in_queue") return null;
  const d = e.details;
  const id =
    typeof d === "object" && d !== null
      ? (d as { tokenId?: unknown }).tokenId
      : undefined;
  return typeof id === "string" && id.length > 0 ? id : null;
}
