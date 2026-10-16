# INC-021: `canceled` Durable Object alarms under load

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | queue engine |
| Status | benign |
| Original ID | F1 |

## Summary

The `wrangler tail` capture of the first cloud runs showed alarms with outcome `canceled`: 50 in the baseline run and 23 in the full run. No state was lost or doubled. We reduced the alarm churn that caused them.

## Impact

None found. The outbox and the "D1 == DO" checks were green in both runs.

The queue engine runs in a Durable Object (DO), one per queue. An alarm is a timer that wakes the DO. The outbox is the DO table of writes that wait to go to D1 or to push.

## Detection

The tail capture of the runs at 2026-10-16T06:21Z (`2026-10-16T06-21-35-955Z-baseline`) and 06:26Z (`2026-10-16T06-26-44-140Z-full`). `wrangler tail` streams the Worker logs.

## Timeline

- 06:21Z and 06:26Z (UTC), 2026-10-16: the two RED runs.
- 06:56Z and 06:59Z: the runs after the fix. `NOTES.md` records that F1 was gone after the redeploy.

## Root cause

Every `canceled` alarm had CPU 0, so our handler never ran. Each one overlapped an RPC or an alarm on the same DO. The mutation set the alarm to now + 250 ms for its new outbox items. Its inline drain then finished about 250 ms later and moved or deleted the alarm while the platform was already sending it.

This is safe. The alarm time comes from storage on every reschedule. The handler changes state in one transaction. Outbox applies are idempotent (safe to run twice).

## Fix

Commit 13b9751 on branch `fix/step3_5-findings`, merged in 0b5d7eb. Before an inline drain, the DO sets the alarm for new outbox items at +5 s, the first backoff step. This alarm is a safety net, set through `reschedule(true)`. It no longer races the drain.

## Verification

A unit test in `apps/api/test/queue-do.test.ts`: a burst of 30 joins leaves no near-term alarm. After the redeploy, `NOTES.md` records F1 as gone.

## Follow-ups

None.

## Lessons

The tail capture is lossy under load. If an event is absent from the tail, that alone proves nothing.
