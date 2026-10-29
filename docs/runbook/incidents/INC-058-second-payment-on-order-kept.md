# INC-058: A second captured payment on one order was kept

| Field | Value |
|---|---|
| Date found | 2026-10-29 |
| Severity | S1 |
| Area | api |
| Status | fixed |
| Original ID | G2 (payments review) |

## Summary

Razorpay allows several payment attempts on one order, and two can be captured (for example a UPI retry). We kept one payment row per order, so the second captured payment was silently ignored and the customer was charged twice. Now any captured payment that is not the order's recorded one becomes a `duplicate_payment` stray row and is refunded in full.

## Impact

No user impact: test mode on `dev` and `loadtest` only. In production a customer could pay twice for one ticket and keep only one.

## Detection

Code review of the Step 4 payments by the orchestrator on 2026-10-29.

## Timeline

2026-10-29: found in review and fixed the same day (UTC times unknown).

## Root cause

`confirmPayment` set `razorpay_payment_id = COALESCE(razorpay_payment_id, ?)` and returned the order's answer for any later payment id, without comparing the ids. Reconciliation only looked at orders still unpaid.

## Fix

`confirmPayment` claims the order for its first captured payment only (`WHERE razorpay_payment_id IS NULL`). Any other captured payment on the order goes to `recordStray`: a row `stray_<payment id>` (order's kind, real amount, `reason = duplicate_payment`, `razorpay_order_id = <order id>:<payment id>`), its capture split, then a full refund that reverses it. Verify, the webhook, the 15-min recovery and the daily reconcile all go through this path. Idempotent by the row id, the ledger ids and the refund receipt. Branch `fix/payments-edge-cases`, fix commit `e1444e1`; merge commit unknown.

## Verification

`apps/api/test/payments-edge.test.ts`, block "G2 · two payments on one order" (4 tests); `npm run check`.

## Follow-ups

None.

## Lessons

One order can have many payments. Key the money on the provider's payment id, and refund every captured payment that did not buy anything.
