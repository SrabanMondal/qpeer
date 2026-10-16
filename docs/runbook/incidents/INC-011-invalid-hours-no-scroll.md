# INC-011: Invalid hours save did not scroll to the bad day

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S3 |
| Area | mobile |
| Status | fixed |
| Original ID | B7 |

## Summary

On an invalid hours save, the app showed a dialog but did not scroll to the first invalid day. It now scrolls first, then shows the alert.

## Impact

The owner had to search the 7 day cards for the error.

## Detection

The Step 1 device check found it. Commit da9edbc recorded it on 2026-10-15.

## Timeline

Unknown.

## Root cause

The hours screen did not know the position of each day card.

## Fix

Commit 52aa5f6 (branch `fix/step1-polish`, merge 90e1ed0). The hours screen gets the day positions from `onLayout` and calls `scrollTo` through a `Screen` ref. Then it shows the alert. The red marks stay on the invalid days.

## Verification

The Step 2 device check re-checked it: an invalid save showed the alert and marked the day.

## Follow-ups

None.

## Lessons

None beyond the fix.
