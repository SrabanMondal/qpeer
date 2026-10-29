# INC-063: A failed refund was never retried, and refunds could race

| Field | Value |
|---|---|
| Date found | 2026-10-29 |
| Severity | S1 |
| Area | api |
| Status | fixed |
| Original ID | none (found while checking the G1–G5 review) |

## Summary

A `refund.failed` webhook only set `refund_status = failed` on a payment already marked `refunded`, so nothing made the refund again. Two callers (for example verify and the webhook) could also create two refunds for one payment at the same time, and a refund was not capped at the captured amount. Now a failed refund returns the payment to `refund_due` with a backoff, refund attempts hold a short lease, and the amount is capped.

## Impact

No user impact: test mode only. In production a customer whose refund failed at the bank would never get the money back, and the ledger would say they had.

## Detection

Checking the refund paths during the payments review on 2026-10-29.

## Timeline

2026-10-29: found and fixed the same day (UTC times unknown).

## Root cause

`markRefund` changed only the refund status. `processRefund` had no claim on the payment between "list refunds" and "create refund", and it reused any refund with our receipt, even a failed one.

## Fix

Migration `0007_payments_edge_cases.sql` adds `payments.refund_attempts` and `payments.refund_retry_at`. `processRefund` takes a 2-minute lease on `refund_retry_at`, ignores failed refunds, reuses a live refund with our receipt, caps the amount at the captured amount minus other live refunds, and on failure counts the attempt and sets the backoff (`refundBackoffMs`: next run, then 15 min, 30 min, 1 h … 6 h). From the 3rd failure on it logs `refund_stuck` at error level. `markRefund` puts a `refund.failed` payment back to `refund_due`. The 15-min `refunds` job skips payments whose backoff is not over. Branch `fix/payments-edge-cases`, fix commit `e1444e1`; merge commit unknown.

## Verification

`apps/api/test/payments-edge.test.ts`, block "Retries and refunds" (refund.failed, replay, backoff and alert, concurrent refunds, cap); `npm run check`.

## Follow-ups

Set up an alert on log lines with `"event":"refund_stuck"` when logs are wired to alerting.

## Lessons

A money call that two paths can make needs a claim (lease) in the database before it calls the provider, and every provider failure needs a retry with a counted backoff and an alert.
