# INC-071: "Close for the day" did not say that paid tickets are refunded

| Field | Value |
|---|---|
| Date found | 2026-10-30 |
| Severity | S3 |
| Area | mobile, shared |
| Status | fixed-unverified-on-device |
| Original ID | Step 4 device check |

## Summary

The close dialog counted the active tickets but did not say that the paid ones among them are refunded in full automatically. It now gives that count, and says that Priority Passes not checked in yet stay valid.

## Impact

A business owner could not see the money effect of closing before confirming it.

## Detection

Step 4 device check on 2026-10-30 (Samsung A9, preview APK EAS build `43cd96c6`, dev Worker): closing OPD with P1 waiting.

## Timeline

2026-10-30: found during the device check and fixed the same day (times unknown).

## Root cause

The dialog was written before Step 4 payments and was not updated with them.

## Fix

- `packages/shared/src/console.ts`: `closeSummary(state, now)` gives the tickets that end, the ones kept for the next session (C4), the paid tickets among those that end (refunded in full, the same rule as the QueueDO's manual close) and the BOOKED passes (not touched by a close). It uses the console state the app already has; no API change was needed.
- `apps/mobile/src/screens/queue-console.tsx`: the dialog adds "N of them are paid tickets and are refunded in full automatically." and "N Priority Passes not checked in yet stay valid."

Paid MISSED tickets are refunded only when the close is during opening hours; the dialog does not count them.

Branch `fix/step4-device-findings`, fix commits `d9bb8df` (helper) and `fd74df9` (app); merge commit unknown.

## Verification

`packages/shared/src/console.test.ts`, "closeSummary (Close for the day)": a paid reservation, a pass at a counter and a late upgrade are counted; a paid ticket that carries over is not. `npm run check` and `expo export` green. Not yet tried on a phone.

## Follow-ups

- On the phone: close with a paid ticket waiting → the dialog names the refund.

## Lessons

None new.
