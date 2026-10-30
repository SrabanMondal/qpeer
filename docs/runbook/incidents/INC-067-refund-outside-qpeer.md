# INC-067: A refund made outside QPeer kept the payment stuck in `refund_due`

| Field | Value |
|---|---|
| Date found | 2026-10-30 |
| Severity | S1 |
| Area | api |
| Status | fixed |
| Original ID | Step 4 device check |

## Summary

`processRefund` looked only for a Razorpay refund whose receipt was our payment id. A refund made in the Razorpay dashboard (no receipt, or another one) was counted as "already refunded" but never adopted, so the payment stayed `refund_due`, every retry failed with `nothing_left_to_refund`, and it was never marked refunded. Now refunds made outside QPeer count towards what we owe: if they cover it, they are adopted; if not, only the remainder is refunded. The `refund.processed` webhook adopts them too.

## Impact

No user impact: test mode. In production the customer would have their money back, but QPeer would show the payment as "Refund started" forever, the ledger would never record the refund, and the `refund_stuck` alert would fire for a payment that needs no action.

## Detection

Step 4 device check on 2026-10-30 (Samsung A9, preview APK EAS build `43cd96c6`, dev Worker). Closing OPD with P1 waiting made the ₹100 pass `refund_due` with reason `closed`. Razorpay test mode rejected every refund on that payment with 400 `BAD_REQUEST_ERROR` "invalid request sent", even a bare `{amount}` request (the ₹20 refund on another payment worked). Our retry, backoff and `refund_stuck` logging behaved correctly. While deciding whether the owner should refund it by hand in the dashboard, we found that our code would not adopt such a refund.

## Timeline

2026-10-30: found during the device check and fixed the same day (times unknown).

## Root cause

`processRefund` summed all live refunds of the Razorpay payment (`before`) but adopted only one with `receipt === payment id`. A full refund from the dashboard made `before` equal to the captured amount, so the amount left was 0 and the code threw `RefundBlocked("nothing_left_to_refund")`, which counts as a failed attempt. `markRefund("processed")` matched only `refund_id`, which we never stored for an outside refund.

## Fix

- `apps/api/src/modules/payments/service.ts`:
  - `processRefund`: our own refund (receipt = payment id) is still reused first. Otherwise, if the live refunds (not `failed`) already cover what we owe, they are adopted (log `refund_outside`, no new refund). If they cover part, only the remainder is refunded (`want − already refunded`).
  - New `recordRefunded`: marks the payment `refunded` with the amount Razorpay really refunded on it (sum of live refunds, capped at the captured amount), `refund_status` `processed` only when all of them are processed, and writes the ledger refund and reversed shares for that amount. Guarded by `status = 'refund_due'` and the deterministic ledger ids, so replays write nothing twice. Sends the `refund_issued` push.
  - `markRefund("processed")` with a refund id we do not know: `adoptOutsideRefund` finds the payment by Razorpay payment id. `refund_due` and covered → adopted at once; covered only in part → left for the next attempt (log `refund_outside_partial`); a payment that owes nothing → log `refund_outside_not_due` for a human.
- `apps/api/src/modules/payments/webhook.ts`: passes the refund entity's `payment_id` to `markRefund`.

Branch `fix/step4-device-findings`, fix commit `feb9a89`; merge commit unknown.

## Verification

`apps/api/test/payments-edge.test.ts`, block "Retries and refunds":

- Full dashboard refund, then our refund is due → adopted once, no new Razorpay refund; replays (again, the cron, the webhook) leave one ledger refund and zero net shares, no `refund_stuck`.
- Our refunds keep failing, then the owner refunds in the dashboard → the `refund.processed` webhook adopts it; a replay under another event id changes nothing.
- Partial dashboard refund, then our full refund is due → we refund only the remainder; the payment records the full amount; a second run does nothing.
- The older "refund by hand, then capped" test now expects the total refunded amount.

`npm run check` green.

## Follow-ups

- The ₹100 pass from the device check is still `refund_due` on the dev Worker. The cause of Razorpay's 400 is unknown (on Razorpay's side; the owner may check the payment in the dashboard). If the owner refunds it there, deploy this fix first so the webhook or the next cron run adopts it.
- An outside refund on a payment that owes nothing (ticket still active) is only logged. Decide later whether it should end the ticket.

## Lessons

Money can move outside our system (the provider's dashboard). Reconcile against the provider's own refund totals for the payment, not only against refunds we made.
