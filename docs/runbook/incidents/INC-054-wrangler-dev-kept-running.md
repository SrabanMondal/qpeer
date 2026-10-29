# INC-054: `wrangler dev` kept port 8787 after its background task stopped

| Field | Value |
|---|---|
| Date found | 2026-10-29 |
| Severity | S4 |
| Area | tooling |
| Status | fixed |
| Original ID | none |

## Summary

After the local Step 4 load test, we stopped the background task that ran `npm run dev:loadtest`. The `wrangler dev` node processes and two `workerd.exe` processes kept running, and `workerd` still listened on 127.0.0.1:8787. We stopped them by their exact process IDs after we checked their command lines.

## Impact

No user impact. A later local run would have hit the old Worker build on port 8787.

## Detection

A process check after stopping the task (`Get-NetTCPConnection -LocalPort 8787`).

## Timeline

2026-10-29 17:46 UTC: the task stopped; port 8787 was still in use. 17:47 UTC: processes stopped by PID.

## Root cause

Stopping the background task does not stop its child processes on Windows (same cause as [INC-038](INC-038-metro-kept-running.md) and [INC-027](INC-027-wrangler-tail-file-lock.md)).

## Fix

A procedure, no code change. After a local `wrangler dev`, find the process that listens on the port, read the command lines of the `npm run dev:loadtest` tree, and stop only those PIDs.

## Verification

Port 8787 had no listener afterwards.

## Follow-ups

None.

## Lessons

See "Tooling" in [lessons.md](../lessons.md): after stopping a background dev server, check its port, not only the task.
