# INC-062: A partial refund could ask for a fraction of a paisa

| Field | Value |
|---|---|
| Date found | 2026-10-29 |
| Severity | S1 |
| Area | queue engine, api |
| Status | fixed |
| Original ID | none (found with the G1–G5 tests) |

## Summary

The outbox set `refund_paise = (amount_paise * pct) / 100` with the percentage bound from JavaScript. D1 binds it as a REAL, so a 33 % refund of ₹99.99 stored 3299.67 paise. That amount went to Razorpay and into the ledger. The SQL now casts to a whole number (floor), and `processRefund` floors the amount as well.

## Impact

No user impact: test mode only, and the default fees and percentages (₹100, 50 %) give whole numbers. With other settings Razorpay would reject the refund, and it would fail on every retry.

## Detection

`apps/api/test/payments-edge.test.ts`, "partial % refund of an odd fee", on 2026-10-29. The test fake now rejects non-integer refund amounts, as Razorpay does.

## Timeline

2026-10-29: found by the new test and fixed the same day (UTC times unknown).

## Root cause

SQLite integer division only happens when both sides are integers. A JavaScript number bound through D1 is a REAL, so the division kept the fraction, and the `INTEGER` column stored it as a REAL.

## Fix

`apps/api/src/queue/outbox.ts`: `refund_paise = CAST((amount_paise * ?) / 100 AS INTEGER)`. `apps/api/src/modules/payments/service.ts`: `processRefund` floors the amount. Branch `fix/payments-edge-cases`, fix commit `e1444e1`; merge commit unknown.

## Verification

The test above; `npm run check`.

## Follow-ups

None (no live payments yet, so no stored fractional values to repair).

## Lessons

In D1 SQL, cast any arithmetic on a bound JavaScript number to `INTEGER` when the result is money.
