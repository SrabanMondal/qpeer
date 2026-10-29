import { z } from "zod";
import { DeviceHash, TokenView } from "./queue";
import { ErrorCode } from "./schemas";

/**
 * Payments (Razorpay test mode, Step 4; architecture doc §10, HLD §6.3). All
 * amounts are integer paise, currency INR. The server decides every amount
 * from the queue settings; the app never sends one.
 */

/** Razorpay's smallest order amount (₹1). Fees below it can't be sold. */
export const MIN_ORDER_PAISE = 100;

/** Demo fee split (HLD §9): the business keeps 70 %, Qpeer 30 %. A platform constant. */
export const DEMO_BUSINESS_SHARE_PCT = 70;

/** An unpaid order expires after this long (cron marks it `expired`). */
export const ORDER_TTL_MS = 30 * 60_000;

export const PaymentKind = z.enum(["reservation", "priority", "upgrade"]);
export type PaymentKind = z.infer<typeof PaymentKind>;

/**
 * created → captured → allocated (token made) → refund_due → refunded, or
 * allocated → forfeited (no-show expiry). created → failed / expired.
 * `refund_due` = a refund is decided and waiting for the Refunds API call.
 */
export const PaymentStatus = z.enum([
  "created",
  "captured",
  "allocated",
  "refund_due",
  "refunded",
  "forfeited",
  "failed",
  "expired",
]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/** Razorpay refund state (`refund.processed` webhook sets `processed`). */
export const RefundStatus = z.enum(["pending", "processed", "failed"]);
export type RefundStatus = z.infer<typeof RefundStatus>;

/**
 * POST /v1/queues/:id/orders (registered users). `reservation` = paid remote
 * join (PAY-01). `priority` = Priority Pass (PRI-02); needs `deviceHash`
 * (PRI-11: 1 pass per account and per phone per queue per IST day).
 */
export const CreateOrderBody = z
  .object({
    kind: z.enum(["reservation", "priority"]),
    deviceHash: DeviceHash.optional(),
  })
  .strict()
  .refine((b) => b.kind !== "priority" || b.deviceHash !== undefined, {
    message: "deviceHash is required for a Priority Pass",
    path: ["deviceHash"],
  });
export type CreateOrderBody = z.infer<typeof CreateOrderBody>;

/** POST /v1/tokens/:id/upgrade ("Skip ahead", PRI-05). */
export const UpgradeBody = z.object({ deviceHash: DeviceHash }).strict();
export type UpgradeBody = z.infer<typeof UpgradeBody>;

/**
 * Answer of order creation (and of the upgrade route): everything Razorpay
 * Checkout needs. `keyId` is the public key id (a Worker secret, never in
 * the app bundle). An unpaid order of the same user is returned again
 * instead of a second one.
 */
export const OrderResponse = z.object({
  paymentId: z.string(),
  kind: PaymentKind,
  orderId: z.string(),
  keyId: z.string(),
  amountPaise: z.number().int(),
  currency: z.literal("INR"),
  queueId: z.string(),
  /** The token being upgraded (upgrade only). */
  tokenId: z.string().nullable(),
  businessName: z.string(),
  queueName: z.string(),
  /** The order can be paid until this time. */
  expiresAt: z.number().int(),
  /** Rules to show before Checkout opens (PAY-02). */
  rules: z.object({
    /** Reservation: refunded when cancelled this long before the estimated call. */
    cancelWindowMin: z.number().int().nullable(),
    /** Pass: share refunded when cancelled before check-in. */
    cancelRefundPct: z.number().int().nullable(),
    /** Pass: validity window in minutes (0 = until the end of today). */
    validityMin: z.number().int().nullable(),
    /** Grace after a no-show before the ticket is MISSED. */
    graceMinutes: z.number().int(),
    /** "I'm here" within this many minutes after MISSED keeps the delay rule (null = no limit). */
    lateWindowMin: z.number().int().nullable(),
  }),
});
export type OrderResponse = z.infer<typeof OrderResponse>;

/** POST /v1/payments/verify: Razorpay Checkout's success callback. */
export const VerifyPaymentBody = z
  .object({
    orderId: z.string().min(1).max(64),
    paymentId: z.string().min(1).max(64),
    signature: z.string().regex(/^[0-9a-f]{64}$/, "Expected a hex signature"),
  })
  .strict();
export type VerifyPaymentBody = z.infer<typeof VerifyPaymentBody>;

/** One payment as its payer sees it (PAY-11). */
export const PaymentView = z.object({
  id: z.string(),
  kind: PaymentKind,
  status: PaymentStatus,
  amountPaise: z.number().int(),
  /** Refunded amount (partial for a pass cancelled before check-in). */
  refundPaise: z.number().int().nullable(),
  refundStatus: RefundStatus.nullable(),
  queueId: z.string(),
  queueName: z.string(),
  businessId: z.string(),
  businessName: z.string(),
  tokenId: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type PaymentView = z.infer<typeof PaymentView>;

/**
 * POST /v1/payments/verify answer. `token` is set once the payment made (or
 * upgraded) a token. `failure`: the payment was taken but no token could be
 * made (quota filled, queue closed, sold out…) and a full refund was started
 * (PAY-06).
 */
export const ConfirmPaymentResponse = z.object({
  payment: PaymentView,
  token: TokenView.nullable(),
  failure: z.object({ code: ErrorCode, message: z.string() }).nullable(),
});
export type ConfirmPaymentResponse = z.infer<typeof ConfirmPaymentResponse>;

/** `?limit=` (1–100, default 20) and `?cursor=` (opaque) on payment lists. */
export const PaymentsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type PaymentsQuery = z.infer<typeof PaymentsQuery>;

/** GET /v1/me/payments. */
export const MyPaymentsResponse = z.object({
  items: z.array(PaymentView),
  nextCursor: z.string().nullable(),
});
export type MyPaymentsResponse = z.infer<typeof MyPaymentsResponse>;

/** A payment as the business owner sees it, with the net split from the ledger. */
export const BusinessPaymentView = PaymentView.extend({
  /** Net business share after refunds (sum of ledger `business_share`). */
  businessSharePaise: z.number().int(),
  /** Net Qpeer share after refunds (sum of ledger `platform_share`). */
  platformSharePaise: z.number().int(),
});
export type BusinessPaymentView = z.infer<typeof BusinessPaymentView>;

/** GET /v1/businesses/:id/payments (owner). */
export const BusinessPaymentsResponse = z.object({
  items: z.array(BusinessPaymentView),
  nextCursor: z.string().nullable(),
});
export type BusinessPaymentsResponse = z.infer<typeof BusinessPaymentsResponse>;

/**
 * GET /v1/queues/:id/priority-preview: the honest preview before buying a
 * pass (PRI-02): "Priority holders wait about X min · regular wait about Y
 * min · you save about Z min". Waits are durations from `at`.
 */
export const PriorityPreview = z.object({
  queueId: z.string(),
  enabled: z.boolean(),
  feePaise: z.number().int(),
  perRegular: z.number().int(),
  soldOut: z.boolean(),
  /** For someone checking in to the priority lane now; null while closed. */
  priorityWait: z
    .object({ lowMs: z.number().int(), highMs: z.number().int() })
    .nullable(),
  /** For someone joining the regular lane now (C3 range); null while closed. */
  regularWait: z
    .object({ lowMs: z.number().int(), highMs: z.number().int() })
    .nullable(),
  /** Midpoint difference, whole minutes, never negative. */
  savingMin: z.number().int(),
  /** False when the saving is below the business threshold (C2). */
  show: z.boolean(),
  at: z.number().int(),
});
export type PriorityPreview = z.infer<typeof PriorityPreview>;

/**
 * Split of an amount: business = floor(amount × pct / 100), Qpeer = the
 * rest, so the shares always add up exactly (§10.3).
 */
export function splitPaise(
  amountPaise: number,
  businessPct: number,
): { business: number; platform: number } {
  const business = Math.floor((amountPaise * businessPct) / 100);
  return { business, platform: amountPaise - business };
}

/**
 * Shares to reverse for a refund of `refundPaise` out of a capture of
 * `amountPaise`: in proportion to the capture split, adding up exactly.
 */
export function refundSplit(
  amountPaise: number,
  refundPaise: number,
  businessPct: number,
): { business: number; platform: number } {
  if (amountPaise <= 0) return { business: 0, platform: 0 };
  const cap = splitPaise(amountPaise, businessPct);
  const business = Math.round((refundPaise * cap.business) / amountPaise);
  return { business, platform: refundPaise - business };
}

/** Refund amount for a percentage (floor, so it never exceeds the fee). */
export function refundAmount(amountPaise: number, pct: number): number {
  return Math.floor((amountPaise * Math.min(100, Math.max(0, pct))) / 100);
}
