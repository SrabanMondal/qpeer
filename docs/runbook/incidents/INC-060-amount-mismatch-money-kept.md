# INC-060: A captured payment of the wrong amount was neither used nor refunded

| Field | Value |
|---|---|
| Date found | 2026-10-29 |
| Severity | S1 |
| Area | api |
| Status | fixed |
| Original ID | G4 (payments review) |

## Summary

When Razorpay reported a captured amount different from the order's, `confirmPayment` logged an error and returned. The money was captured but no ticket was made and nothing was refunded. Now the payment becomes an `amount_mismatch` stray row and the actual captured amount is refunded in full.

## Impact

No user impact: test mode only. In production the customer's money would have been kept with no ticket until someone noticed the log line.

## Detection

Code review of the Step 4 payments by the orchestrator on 2026-10-29.

## Timeline

2026-10-29: found in review and fixed the same day (UTC times unknown).

## Root cause

The mismatch check returned early instead of deciding what happens to the money. The daily reconcile also skipped mismatches.

## Fix

`confirmPayment` sends a captured payment whose amount (or currency) does not match the order to `recordStray(..., "amount_mismatch")`: its own row with the real amount, a capture split, a full refund of that amount, and an error log. The order stays unpaid and can still be paid correctly. An `authorized` payment of the wrong amount is never captured. Branch `fix/payments-edge-cases`, fix commit `e1444e1`; merge commit unknown.

## Verification

`apps/api/test/payments-edge.test.ts`: "captured amount ≠ order amount → …" and "authorized for an amount other than the order's → …"; `npm run check`.

## Follow-ups

None.

## Lessons

A guard on money must decide where the money goes (ticket or refund). Logging and returning leaves it stuck.
