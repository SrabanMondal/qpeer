# INC-065: A user could buy a second paid reservation in the same queue

| Field | Value |
|---|---|
| Date found | 2026-10-30 |
| Severity | S2 |
| Area | api, queue engine, mobile |
| Status | fixed-unverified-on-device |
| Original ID | none (found by review 2026-10-30) |

## Summary

The owner decided on 2026-10-18: one active ticket per person per queue. Paid reservations still followed the older `paidPerUserCap` setting (default 2). A user whose webhook had already made the ticket, but whose app lost the answer, could tap Pay again and buy a genuine second reservation. Now any active ticket of the user in the queue refuses a paid reservation, at order time and at confirm time, and the app opens the existing ticket.

## Impact

No user impact: test mode only. In production a customer could pay twice and hold two places in one queue, and a free-ticket holder could add a paid one.

## Detection

Review on 2026-10-30 of the G5 fix (INC-061), which documented that "a paid reservation does not by itself block another one".

## Timeline

2026-10-30: found and fixed the same day (UTC times unknown).

## Root cause

The QueueDO's `checkQuota` (order time) and `allocateCore` (confirm time, paid branch) counted only the user's active *paid* tokens against `paidPerUserCap`. The one-ticket rule from 2026-10-18 was applied to free tickets and Priority Passes, not to paid reservations.

## Fix

- `apps/api/src/queue/queue-do.ts`: `checkQuota` (used by `checkPurchase` for `POST /v1/queues/:id/orders`, kind `reservation`) answers `409 already_in_queue` with `details.tokenId` when the user has any active ticket here (BOOKED, WAITING, CALLED, GRACE or MISSED; staff-made tickets aside). `allocateCore` refuses a paid reservation the same way, so `confirmPayment` marks the payment `refund_due` with reason `already_in_queue` and refunds it in full (PAY-06 path).
- `paidPerUserCap` is retired: still accepted and stored by the settings schema (older settings keep validating), never read. Documented in `packages/shared/src/queue-settings.ts` and the architecture doc.
- A free walk-in while holding a paid reservation is still allowed (unchanged, architecture doc §23, "Built in Step 4", row "Walk-in while holding a pass").
- App (`apps/mobile/src/lib/pay-flow.ts`, `apps/mobile/src/app/pay.tsx`): a `409 already_in_queue` with `details.tokenId` from `POST /v1/queues/:id/orders` or `POST /v1/tokens/:id/upgrade` opens that ticket with a toast "You already have a ticket here". In the same change: a `409 invalid_state` with `details.paymentStatus` from verify goes to the "Payment received — confirming" polling path, and a `502 payment_provider_error` from verify is retried twice (2 s, 4 s) before polling.

Branch `fix/payments-followups`, fix commits `e347cc6` (API) and `fcd70ff` (app); merge commit unknown.

## Verification

`apps/api/test/payments-edge.test.ts`, block "one active ticket per person per queue · paid reservations": allocated reservation → a new order is 409 with its `tokenId` and no new Razorpay order; a free ticket and a booked pass both block; a ticket made after the order → the paid reservation is refunded in full with reason `already_in_queue` and the free ticket stays. `npm run check`. The app change is type-checked and bundled (`expo export`), not yet tried on a phone.

## Follow-ups

- Try the pay screen on a phone: Pay with an existing ticket opens it with the toast.
- At confirm time the verify answer carries only the failure code, not the existing ticket's id; the app shows "No ticket could be made … You already have a ticket in this queue." with the refund note. Adding `tokenId` to `failure` would let it open the ticket.

## Lessons

When the owner changes a rule, search every path that enforces the old one (settings, DO checks, docs) and retire the old setting explicitly.
