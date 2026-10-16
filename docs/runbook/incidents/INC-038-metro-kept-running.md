# INC-038: Metro kept running after its background task stopped

| Field | Value |
|---|---|
| Date found | unknown (between 2026-10-14 and 2026-10-16) |
| Severity | S4 |
| Area | tooling |
| Status | fixed |
| Original ID | none |

## Summary

We stopped the background task that ran Metro, the JavaScript bundler for the app. The Metro process kept running. We stopped it by its exact process ID after we checked its command line.

## Impact

No user impact. Any other effect is unknown.

## Detection

Metro was still running after the task stopped.

## Timeline

Unknown.

## Root cause

Stopping the background task did not stop its child processes on Windows.

## Fix

A procedure, no code change. Find the `node` process, read its command line, and stop it by PID only if it is the Metro of this repo.

## Verification

Metro stopped.

## Follow-ups

None.

## Lessons

See "Tooling" in [lessons.md](../lessons.md). The same problem happened with `wrangler tail` in [INC-027](INC-027-wrangler-tail-file-lock.md).
