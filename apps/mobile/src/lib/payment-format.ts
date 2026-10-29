import type { PaymentKind, PaymentView } from "@qpeer/shared";

import type { BadgeTone } from "@/components/ui/badge";
import { formatRupees } from "@/lib/format";

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  reservation: "Reservation",
  priority: "Priority Pass",
  upgrade: "Skip ahead",
};

/** Share of the fee refunded, 0–100 (rounded). */
export function refundPct(p: Pick<PaymentView, "amountPaise" | "refundPaise">) {
  if (!p.refundPaise || p.amountPaise <= 0) return 0;
  return Math.round((p.refundPaise / p.amountPaise) * 100);
}

/**
 * PAY-11: one status word per payment: paid / refunded x% / forfeited (fee
 * kept after a no-show) / not paid.
 */
export function paymentStatus(p: PaymentView): {
  label: string;
  tone: BadgeTone;
  detail: string | null;
} {
  const pct = refundPct(p);
  const back = p.refundPaise ? formatRupees(p.refundPaise) : null;
  switch (p.status) {
    case "created":
      return { label: "Not paid", tone: "neutral", detail: null };
    case "captured":
      return {
        label: "Paid · confirming",
        tone: "warning",
        detail: "Qpeer is making your ticket.",
      };
    case "allocated":
      return { label: "Paid", tone: "success", detail: null };
    case "refund_due":
      return {
        label: pct >= 100 ? "Refund started" : `Refund started · ${pct}%`,
        tone: "warning",
        detail: back ? `${back} is on its way back to you.` : null,
      };
    case "refunded":
      return {
        label: pct >= 100 ? "Refunded" : `Refunded ${pct}%`,
        tone: "neutral",
        detail: back
          ? `${back} refunded${p.refundStatus === "processed" ? "" : " (on its way to your account)"}.`
          : null,
      };
    case "forfeited":
      return {
        label: "Forfeited",
        tone: "danger",
        detail: "The fee was kept: the ticket was not used in time.",
      };
    case "failed":
      return {
        label: "Failed",
        tone: "neutral",
        detail: "Nothing was charged.",
      };
    default:
      return {
        label: "Not paid",
        tone: "neutral",
        detail: "The order expired before it was paid.",
      };
  }
}
