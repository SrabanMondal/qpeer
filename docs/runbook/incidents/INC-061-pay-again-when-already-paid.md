# INC-061: Order creation could send a paid purchase to Checkout again

| Field | Value |
|---|---|
| Date found | 2026-10-29 |
| Severity | S2 |
| Area | api |
| Status | fixed |
| Original ID | G5 (payments review) |

## Summary

If the app lost Checkout's answer and the webhook was late, our order row was still `created`. Asking for the order again returned the same order, so the app opened Checkout again and the customer could pay twice. A captured payment whose ticket was not made yet was also not seen. Now order creation confirms such payments first and answers `409 already_in_queue` with `details.tokenId`, so the app opens the existing ticket.

## Impact

No user impact: test mode only. With INC-058 fixed a second payment would be refunded, but the customer would still see a second charge and a refund.

## Detection

Code review of the Step 4 payments by the orchestrator on 2026-10-29.

## Timeline

2026-10-29: found in review and fixed the same day (UTC times unknown).

## Root cause

`reusableOrder` / `passLimit` trusted the D1 status `created` without asking Razorpay, and order creation never looked at the user's `captured` payments.

## Fix

`apps/api/src/modules/payments/service.ts`: `openTicketInstead` (before the DO check) confirms the user's `captured` payments for this queue and kind (and, for an upgrade, any paid upgrade of the same ticket) and throws `409 already_in_queue` with `{ tokenId, paymentId }` when the ticket is active. `reuseUnlessPaid` asks Razorpay (`fetchOrderPayments`) before an unpaid order is returned again; a paid attempt is confirmed and answers `already_in_queue`, or the reason its ticket could not be made. No new error code: `already_in_queue` with `details.tokenId` is what the app already handles by opening the ticket. A paid reservation alone does not block a second one, because `paidPerUserCap` (default 2) allows two per user and queue. Branch `fix/payments-edge-cases`, fix commit `e1444e1`; merge commit unknown.

## Verification

`apps/api/test/payments-edge.test.ts`, block "G5 · no second Checkout for a paid purchase" (5 tests); `npm run check`.

## Follow-ups

The app should treat `already_in_queue` from `POST /v1/queues/:id/orders` and `POST /v1/tokens/:id/upgrade` like the join flow: open `details.tokenId`. If the product wants "one paid reservation per person" instead of the cap of 2, that is a settings decision, not this fix.

Update 2026-10-30: both done in [INC-065](INC-065-second-paid-reservation.md) (the app opens `details.tokenId`; one active ticket per person per queue now covers paid reservations and the cap is retired).

## Lessons

Before you offer a payment again, ask the provider whether the last one already went through.
