# INC-031: Two full load-test runs overlapped

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | process |
| Status | benign |
| Original ID | none (07:32 full run, "audit: 404 not_found") |

## Summary

The full run that started at 07:32Z ended RED with the run error `audit: 404 not_found`. It was not a product bug. The orchestrator command timeout of 10 minutes fired during the run's check phase, but the process did not stop. The orchestrator started the next run, and its reset wiped D1 under the first run.

## Impact

No user impact. One run report is not valid.

## Detection

Report `2026-10-16T07-32-48-423Z-full` and `.orch/full-r3.out`, the console output of the next run. Round 3 in `NOTES.md` listed the error as not investigated. The orchestrator found the cause later on 2026-10-16.

## Timeline

All times UTC on 2026-10-16:

- 07:32:48: full run A started.
- 07:39:06: full run B started.
- 07:39:09: the reset of run B closed 10 queues and wiped 282 tokens. Run A had 282 tokens.
- 07:40:22: run A ended. 21 of its 31 audit calls returned 404, and all 10 of its close calls returned 404.

## Root cause

The command timeout stopped the wait but not the process. A run longer than 10 minutes then overlapped with the next run, and both used the same `qpeer-loadtest` D1 database.

## Fix

A rule, no code change. A run longer than 10 minutes goes in the background. Only one run at a time.

## Verification

The proof is the timeline above. The token count wiped by run B is the token count of run A. Later runs ran one at a time: 07:58Z baseline and 08:03Z full were both green.

## Follow-ups

None.

## Lessons

See "Load-test operation" in [lessons.md](../lessons.md).
