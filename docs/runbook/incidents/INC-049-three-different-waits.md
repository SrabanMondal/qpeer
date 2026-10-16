# INC-049: One queue showed three different waits at the same moment

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S2 |
| Area | mobile, shared |
| Status | fixed-unverified-on-device |
| Original ID | none (coordinator phone check; with B19) |

## Summary

At the same moment, Demo Clinic OPD showed "0 · ~5 min" on the map pill, "about 2–8 min" on the business card, list and public page, and "about 0–3 min" on the join screen and the ticket. Every surface now uses the DO's estimate through one shared helper and one formula.

## Impact

A customer could not tell how long the wait was.

## Detection

The coordinator saw it on the phone on 2026-10-16.

## Timeline

Unknown.

## Root cause

Two differences together. (1) Two formats: the pill showed the midpoint ("~5 min"), the other surfaces the range ("about 2–8 min"). (2) Two ages: the map, card, list and page read the D1 snapshot, whose wait range is a duration measured when the snapshot was written; the join screen and ticket read the DO live, a few minutes later. The DO's estimate falls as time passes since the last call (expected = last call + k × mean), so the old snapshot showed a longer wait.

## Fix

Branch `feat/fix-batch-rebuild`, commits 8e17550 (shared `live-text.ts`) and 9627e5f / b691163 / 75c38f1 (screens). One formula everywhere: the midpoint of the DO's range as "~N min" (`approxDuration`). Snapshot waits are aged to "now" with the snapshot's `updatedAt` (`waitRangeAt`), which gives the same numbers the DO would give now. The map pill, card, list, business page, join screen and console use `waitText`/`waitSummary` with the server-corrected clock; the ticket formats its own range with the same function. The 0-waiting texts come from INC-046.

## Verification

`live-text.test.ts` ("a snapshot's age is subtracted, so it agrees with a live summary") and the `map-view.test.ts` B19 case with a 2-minute-old snapshot. Not yet checked on a phone.

## Follow-ups

Device check: open the map card, the list, the page and the join screen of one queue within a minute; all show the same wait.

## Lessons

A number shown on several screens needs one source and one formatting function, and a cached duration must carry the time it was measured.
