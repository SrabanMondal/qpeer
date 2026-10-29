import { type OrderResponse, refundAmount } from "@qpeer/shared";

import { formatRupees } from "@/lib/format";
import { formatMinutes } from "@/lib/queue-format";

/** "until the end of today" / "for 2 h after you buy it". */
export function passValidityText(validityMin: number | null): string {
  if (validityMin === null || validityMin <= 0) return "until the end of today";
  return `for ${formatMinutes(validityMin)} after you buy it`;
}

/**
 * PAY-02: the rules shown before Checkout opens, from the order's `rules`
 * (the business's settings at purchase time). Plain sentences: fee, what is
 * refunded, when the fee is kept.
 */
export function payRules(order: OrderResponse): string[] {
  const r = order.rules;
  const fee = formatRupees(order.amountPaise);
  const late =
    r.lateWindowMin === null
      ? "Tap I'm here when you arrive to rejoin, once."
      : `Tap I'm here within ${formatMinutes(r.lateWindowMin)} to rejoin a little later in the line (once); after that you rejoin at the end.`;
  const missed = `If you are not at the counter when called, you have ${formatMinutes(r.graceMinutes)} to come. After that your turn is missed. ${late}`;
  const closes =
    "If the queue closes before you are served, or the business cancels, you get the full fee back automatically.";

  switch (order.kind) {
    case "reservation":
      return [
        `You pay ${fee} to hold a place in the line from wherever you are.`,
        r.cancelWindowMin !== null && r.cancelWindowMin > 0
          ? `Cancel at least ${formatMinutes(r.cancelWindowMin)} before your estimated turn: full refund. Later: no refund.`
          : "Cancel before you are called: full refund. Later: no refund.",
        missed,
        "If you never come, the fee is kept.",
        closes,
      ];
    case "priority":
      return [
        `You pay ${fee} for a Priority Pass. It is valid ${passValidityText(r.validityMin)}.`,
        "You are not in the line yet. At the business, tap Check in (a one-time location check) and you join the priority lane.",
        r.cancelRefundPct !== null && r.cancelRefundPct > 0
          ? `Cancel before you check in: ${r.cancelRefundPct}% back (${formatRupees(refundAmount(order.amountPaise, r.cancelRefundPct))}).`
          : "Cancelling before check-in gives no refund.",
        "Not checked in before the pass ends: no refund.",
        missed,
        `After check-in, leaving or missing your turn keeps the fee. ${closes}`,
        "The pass is for you only: it can't be given to someone else.",
      ];
    default:
      return [
        `You pay ${fee} and your ticket moves to the priority lane at once. It keeps its number.`,
        "No refund after the move, but if you are already called before the payment is confirmed, the full fee comes back automatically.",
        missed,
        closes,
      ];
  }
}
