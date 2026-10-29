# INC-057: A ticket could be made for a payment that was never captured

| Field | Value |
|---|---|
| Date found | 2026-10-29 |
| Severity | S1 |
| Area | api |
| Status | fixed |
| Original ID | G1 (payments review) |

## Summary

`confirmPayment` made a paid ticket as soon as the client's Checkout signature was valid. It never asked Razorpay whether the money was captured. Now verify fetches the payment from Razorpay; only `captured` counts, an `authorized` payment of the order's amount is captured first, and anything else answers `409 invalid_state`.

## Impact

No user impact: the code was only on `dev` and `loadtest` in test mode. In production, an account with auto-capture off (or a payment stuck in `authorized`) would have given a ticket for money that Razorpay later released back to the customer.

## Detection

Code review of the Step 4 payments by the orchestrator on 2026-10-29.

## Timeline

2026-10-29: found in review and fixed the same day (UTC times unknown).

## Root cause

The verify path treated a valid `orderId|paymentId` signature as proof of payment. A signature proves that Checkout returned the payment id, not that the payment was captured. The webhook only handled `payment.captured`, so an `authorized` payment was never captured.

## Fix

`apps/api/src/modules/payments/service.ts`: `confirmPayment` gets Razorpay's entity (the signed webhook entity, a Razorpay list, or `fetchPayment` for verify) and `ensureCaptured` captures an `authorized` payment of the right amount (`capturePayment`, new in the transport). The webhook handles `payment.authorized`. The verify route answers `409 invalid_state` with `details.paymentStatus` when the payment is not captured. Branch `fix/payments-edge-cases`, fix commit `e1444e1`; merge commit unknown (not merged yet).

## Verification

`apps/api/test/payments-edge.test.ts`, block "G1 · captured means money" (5 tests); `npm run check`.

## Follow-ups

None.

## Lessons

A client signature is never money. Ask the payment provider for the payment's status before making anything paid.
