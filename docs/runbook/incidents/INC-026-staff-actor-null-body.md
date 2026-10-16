# INC-026: Load-test staff actor crashed on a null body

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | loadtest harness |
| Status | fixed |
| Original ID | F4 |

## Summary

The simulator logged `Cannot read properties of null (reading 'console')`. A `POST /next` returned headers with status 200, but the body read hit the 20 s abort. The client kept status 200 with a null body, and the staff loop read a field of null. That queue's staff actor stopped.

## Impact

No user impact. One queue in the run had no staff actions after the crash.

## Detection

The simulator output of the full run at 06:26Z UTC on 2026-10-16. Report `2026-10-16T06-26-44-140Z-full` shows the longest `POST /queues/:id/next` at 20004 ms, and every `next` answer had status 200 or 409.

## Timeline

Unknown beyond the run time.

## Root cause

`Api.req` in the simulator did not treat a failed body read as a failure.

## Fix

Commit ca634e0 on branch `fix/step3_5-findings`, merged in 0b5d7eb. A failed body read or parse now returns status 0 with `error: bad_body:<status>:<kind>`. The staff loop also requires an object body.

## Verification

`NOTES.md` records that F4 was gone after the round-1 redeploy.

## Follow-ups

None.

## Lessons

A load-test client must treat a broken body as a failed request, even with status 200.
