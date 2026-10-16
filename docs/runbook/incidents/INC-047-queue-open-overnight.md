# INC-047: A queue stayed open overnight with a called ticket

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S2 |
| Area | queue engine |
| Status | fixed-unverified-on-device |
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

Branch `feat/fix-batch-rebuild`, commits 8e17550 (shared `autoCloseAt`), 610e9e8 (DO alarm, cron job, keep-open route) and 75c38f1 (console). The owner agreed the rule on 2026-10-16. An open session closes 30 min after the end of the last hours range of the IST day it opened. A session opened after that range, or on a closed day, closes at 23:59 IST of that day (decision: staff working off-hours keep the evening and tap Keep open past midnight). It never closes sooner than 30 min after opening. The DO closes on its own alarm; the 15-minute cron passes each open queue its hours and closes overdue sessions (safety net, e.g. sessions opened before the deploy, like this one). From 15 min before, the console shows "Closes by itself at …" with **Keep open**, which moves the time 1 h later per tap. Closing ends the tickets exactly like Close, except tickets that are still valid under the new ticket-validity setting (C4), which carry over.

## Verification

`apps/api/test/fix-batch.test.ts`: alarm auto-close, Keep open twice, carry-over on auto-close, the cron closing a DO that had no hours, keep-open route auth, hours edit moves the time; `hours.test.ts` for the rule. Not yet checked on a phone.

## Follow-ups

1. After deploy, check that the forgotten demo queues on `dev` closed (D1 `queue_snapshots.is_open`).
2. Step 4: refund paid tokens ended by the auto-close (TODO in `queue-do.ts`).

## Lessons

A deferred safety job becomes a visible bug as soon as real data lives longer than one day.
