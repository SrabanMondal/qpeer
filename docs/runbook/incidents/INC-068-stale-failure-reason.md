# INC-068: A paid order kept the failure code of an earlier attempt

| Field | Value |
|---|---|
| Date found | 2026-10-30 |
| Severity | S3 |
| Area | api |
| Status | fixed |
| Original ID | Step 4 device check |

## Summary

After a failed payment attempt and a later successful one on the same order, `payments.reason` still held `BAD_REQUEST_ERROR` from the failure. The reason is now cleared when the order's payment is captured.

## Impact

No user saw it. The payment row looked failed to anyone reading the database or a business payment export, although it was paid and had its ticket.

## Detection

Step 4 device check on 2026-10-30 (Samsung A9, preview APK EAS build `43cd96c6`, dev Worker): the ₹20 reservation at Billu Barbar failed on the first attempt and succeeded on the retry on the same order. Exactly one ticket and one ledger set were made, as they should be, but the row kept the old reason.

## Timeline

2026-10-30: found during the device check and fixed the same day (times unknown).

## Root cause

`markFailed` (`payment.failed` webhook) sets `reason` to Razorpay's error code. The capture claim in `confirmPayment` changed the status and the Razorpay payment id but did not touch `reason`.

## Fix

`apps/api/src/modules/payments/service.ts`: the capture claim (`UPDATE … SET status = 'captured'`) also sets `reason = NULL`. Stray rows (`duplicate_payment`, `amount_mismatch`) are separate rows and keep their reasons.

Branch `fix/step4-device-findings`, fix commit `8e574ad`; merge commit unknown.

## Verification

`apps/api/test/payments-edge.test.ts`, "payment.failed, then a retry succeeds on the same order → one ticket": now also checks that `reason` is null. `npm run check` green.

## Follow-ups

None. Rows already on the dev D1 keep the old reason.

## Lessons

When a row moves to a new state, reset every field that describes the old state.
