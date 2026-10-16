# INC-046: "0 waiting" still showed a wait time

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | mobile, shared |
| Status | fixed |
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

Branch `feat/fix-batch-rebuild`, commits 8e17550 (shared `live-text.ts`), 610e9e8 (`inService` in the live summary, snapshot column `in_service`, map summary) and 9627e5f / b691163 (screens). With 0 waiting: "No wait" when nobody is at a counter, "Next in ~N min" when someone is. Otherwise "N waiting · ~N min" (map pill: "N · ~N min"). The pill, card, list, business page, join screen and console use the same helper. See INC-049 for the formula.

## Verification

`live-text.test.ts` and `map-view.test.ts` (B19 cases); DO test of `inService`. Device check on 2026-10-16 with the preview APK: with nobody waiting and nobody called, the map pill, the card, the business page and the join screen showed "No wait", and the console showed "Someone joining now: No wait." A related gap after joining is INC-053.

## Follow-ups

None.

## Lessons

None yet.
