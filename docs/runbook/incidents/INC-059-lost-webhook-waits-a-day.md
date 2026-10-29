# INC-059: A lost webhook plus no verify waited a day for recovery

| Field | Value |
|---|---|
| Date found | 2026-10-29 |
| Severity | S2 |
| Area | api |
| Status | fixed |
| Original ID | G3 (payments review) |

## Summary

If the Razorpay webhook was lost and the app never called verify (for example the phone's battery died after Checkout), only the daily reconcile at 03:00 IST found the payment. A new 15-minute job, `recover_orders`, now asks Razorpay about our recent unpaid orders and confirms any paid attempt.

## Impact

No user impact: test mode only. In production a customer could pay and have no ticket for up to a day.

## Detection

Code review of the Step 4 payments by the orchestrator on 2026-10-29.

## Timeline

2026-10-29: found in review and fixed the same day (UTC times unknown).

## Root cause

The only recovery path for a missed capture was the daily `reconcile`.

## Fix

`recoverRecentOrders` in `apps/api/src/modules/payments/service.ts`, run by the 15-min trigger (`apps/api/src/cron/jobs.ts`, after `expire_orders`): captured payments without a ticket for 2+ minutes are confirmed again; orders still `created` / `failed` / `expired` from the last 2 h (at most 15 per run, the one checked longest ago first) are looked up with `fetchOrderPayments` and every paid attempt goes through `confirmPayment` (G1 capture and G2/G4 strays apply). The daily reconcile stays. Branch `fix/payments-edge-cases`, fix commit `e1444e1`; merge commit unknown.

## Verification

`apps/api/test/payments-edge.test.ts`, block "G3 · recovery within 15 minutes" (8 tests: lost webhook, authorized, late capture after expiry, a late capture that must be refunded, the 2 h limit, unknown order, the half-done DO/D1 step); `npm run check`.

## Follow-ups

Watch the per-invocation subrequest limit: one cron run now makes up to 15 order lookups plus the refunds job's calls.

## Lessons

Every money path needs a recovery that does not depend on the client or on one webhook, and it should run within minutes.
