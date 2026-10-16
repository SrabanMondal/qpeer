# INC-034: Client connect failures failed the run, and lost staff actions were not modeled

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | loadtest harness |
| Status | fixed |
| Original ID | H2 |

## Summary

The full run at 07:39Z failed "No unexpected responses" on connect failures only: `GET /tokens/:id → 0  (connect) × 2` and `POST /queues/:id/tokens/:tid/skip → 0  (connect) × 1`. The run also had 14 client connect retries. The checker now reports client network failures in their own check and models staff actions whose answer was lost.

## Impact

No user impact. The run was RED for client link problems.

## Detection

Report `2026-10-16T07-39-06-823Z-full` (07:39Z UTC, 2026-10-16).

## Timeline

Unknown beyond the run time.

## Root cause

The checker counted a request that never got a connection as a server failure. Also, any skip event exempted its token from the order checks, even a rejected skip.

## Fix

Commit ec07426 ("fix: report client connect failures apart and model lost staff actions") on branch `fix/step3_5-round3`, merged in 9e120b4:

- A new check, "Client network failures stay rare", lists requests with no connection after the retries. It fails only above 1 % of requests.
- "No unexpected responses" still fails on timeouts, 5xx, broken connections on calls that are not idempotent, bad bodies and wrong codes.
- A skip, undo or Next with a lost answer (status 0 but not `connect`) counts as "may have happened". The order, people-ahead, undo and push-count checks use this. A connect failure or a 409 does not count.
- After a lost action, the staff loop keeps its last console state until the next answer.

## Verification

The full run at 08:03Z UTC was green, with 0 client connect retries.

## Follow-ups

None.

## Lessons

Same as [INC-022](INC-022-client-connect-timeouts.md).
