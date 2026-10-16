# INC-027: `wrangler tail` processes kept the tail log locked

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | tooling |
| Status | fixed |
| Original ID | none |

## Summary

During Step 3.5, we stopped the background task that ran `npx wrangler tail`. Its `node` child processes kept running and kept the tail log file locked. We stopped them by process ID after we checked their command line.

## Impact

No user impact. We were not able to use the tail log file until the processes stopped.

## Detection

The tail log file was still locked after the task stopped. The exact error is unknown.

## Timeline

Unknown time on 2026-10-16.

## Root cause

Stopping the background task did not stop the `node` child processes of `npx wrangler tail` on Windows.

## Fix

A procedure, no code change. Find the `node` processes, read the command line of each, and stop only the ones that run `wrangler tail`, by PID.

## Verification

Not recorded in detail. Later runs wrote new tail logs (`.orch/tail-r3.log`, `.orch/tail-r4.log`).

## Follow-ups

None.

## Lessons

See "Tooling" in [lessons.md](../lessons.md).
