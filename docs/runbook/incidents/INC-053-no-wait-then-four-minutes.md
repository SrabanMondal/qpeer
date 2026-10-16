# INC-053: "No wait" before joining, "~4 min" right after

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | mobile, shared |
| Status | open |
| Original ID | none |

## Summary

The OPD queue had nobody waiting and nobody called. The map, the business page and the join screen showed "No wait". Right after the tester joined, ticket #1 showed "Estimated wait ~4 min" and "You are next · ~4 min" with 0 people ahead.

## Impact

The promise before joining does not match the ticket after joining.

## Detection

Device check of the preview APK on 2026-10-16 at 21:15 IST.

## Timeline

Unknown.

## Root cause

Unknown. Probable: the ticket estimate for the head of the queue still adds a call interval (EWMA of the time between calls), while the join text uses the B19 rule "No wait" for an empty queue.

## Fix

Not done. Decide one rule for the head of an empty queue: for example "You are next, staff will call you soon" without minutes, or the same minutes on both screens.

## Verification

Not yet.

## Follow-ups

None.

## Lessons

None yet.
