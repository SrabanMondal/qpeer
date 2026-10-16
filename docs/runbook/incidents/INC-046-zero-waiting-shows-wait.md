# INC-046: "0 waiting" still showed a wait time

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | mobile, shared |
| Status | open |
| Original ID | B19 |

## Summary

Demo Clinic had nobody waiting and one person at the counter. The map pill showed "0 · ~5 min". The list and the public page showed "0 waiting · about 2–8 min".

## Impact

A customer reads "0 waiting" and a wait of several minutes together, and does not know which to believe.

## Detection

Step 3 device check on 2026-10-16.

## Timeline

Unknown.

## Root cause

The wait range includes the service time of the person at the counter. The labels (`markerLabel`, `shortWait` in `packages/shared/src/map-view.ts`) show the range even when the waiting count is 0.

## Fix

Not done. Decide the text: for example "No wait" when nobody waits and nobody is called, and "Next in ~5 min" when somebody is at the counter. Use the same text on the pill, the card, the list and the page.

## Verification

Not yet.

## Follow-ups

None.

## Lessons

None yet.
