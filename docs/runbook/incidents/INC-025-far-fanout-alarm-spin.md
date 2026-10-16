# INC-025: Far fan-out flag made the alarm spin

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | queue engine |
| Status | fixed |
| Original ID | none (found while investigating F3) |

## Summary

While we investigated [INC-024](INC-024-socket-expired-checker-race.md), the tail showed that DO `41c9a15f` ran its alarm every 0.25 to 1 s from 06:32:29 UTC until after the queue closed. The far fan-out flag stayed set when it had nothing to send. We now clear the flag in that case.

## Impact

Wasted alarm runs on one DO from 06:32:29 UTC until after close. No wrong state was found.

Far fan-out is the slower update (at most every 30 s) for socket clients more than 20 places from the front.

## Detection

The `wrangler tail` capture of the full run at 06:26Z (`2026-10-16T06-26-44-140Z-full`).

## Timeline

- 06:32:29 UTC, 2026-10-16: the alarm loop started.
- Until after close: the loop continued.

## Root cause

The far fan-out flag stayed dirty after the held-back sockets moved near the front or closed. `farFanout` was then due in the past for ever, so each alarm scheduled the next one at once.

## Fix

Commit 13b9751 on branch `fix/step3_5-findings`, merged in 0b5d7eb. In `broadcast()` in `apps/api/src/queue/queue-do.ts`, the DO clears the flag when it is due and nothing far is pending.

## Verification

A unit test in `apps/api/test/queue-do.test.ts` ("a held-back far update that is no longer owed doesn't keep re-arming the alarm"). It fails without the fix.

## Follow-ups

None.

## Lessons

When you investigate a checker false alarm, read the whole log of that object. INC-024 was harmless, but the same DO had a real bug.
