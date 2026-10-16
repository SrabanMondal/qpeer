# INC-047: A queue stayed open overnight with a called ticket

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S2 |
| Area | queue engine |
| Status | open |
| Original ID | B20 |

## Summary

The OPD queue of Demo Clinic was opened during the device check on 2026-10-15. At 19:08 on 2026-10-16 it was still open, and ticket #2 was still CALLED ("called 11:52 PM").

## Impact

A forgotten queue stays open after closing time. Old tickets stay active, customers can join a closed business, and the map shows a wrong state (see INC-043).

## Detection

Step 3 device check on 2026-10-16.

## Timeline

Unknown.

## Root cause

Auto-close at closing time is not built. Step 2 deferred it and left a slot in the 15-minute cron (see `NOTES.md`, Step 2 backend, "Deferred").

## Fix

Not done. Proposed: the 15-minute cron closes each open queue a set time after the last hours range of the day (for example 30 minutes), unless staff pressed an action recently. Closing ends the remaining tickets as it does today.

## Verification

Not yet.

## Follow-ups

Add a console notice before the auto-close, so staff who work late can keep the queue open.

## Lessons

A deferred safety job becomes a visible bug as soon as real data lives longer than one day.
