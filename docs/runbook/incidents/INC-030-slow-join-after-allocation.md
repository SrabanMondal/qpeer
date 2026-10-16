# INC-030: A join took 20 s after the DO made the token

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | queue engine |
| Status | fixed |
| Original ID | G2 |

## Summary

The full run had a join that timed out at 20 s, but the join had already made its token. The retry got `already_in_queue`. The stall came after allocation, in the outbox drain that every RPC waited for. We split the drain in two and capped the wait.

## Impact

Under load, a customer waited up to 20 s for a join answer. The outbox is the DO table of writes that wait to go to D1 or to push.

## Detection

Report `2026-10-16T06-59-56-242Z-full` (06:59Z UTC, 2026-10-16): `POST /queues/:id/join → 0  (timeout) × 1`. There was no tail capture for this run. We found the cause from the reports and from the code.

## Timeline

- 06:59Z: full RED.
- 07:39Z and 08:03Z: full runs after the fix. The 08:03Z run was green.

## Root cause

Every mutating RPC awaited one shared, serial outbox drain of rows, pushes and analytics. Nothing limited how long it waited for D1 or for earlier drains. Other endpoints were slower in this run too: `/me/devices` p50 was 825 ms against 344 ms before. That points at D1, which has one writer that all queues share, and at the client link.

## Fix

Commit 538d6de ("perf: drain pushes in the background and bound row waits") on branch `fix/step3_5-round2`, merged in 8ed5c43:

- Two chained drains replace the one drain. The rows drain sends token rows and snapshots in batches of at most 50, each at most 8 s. The RPC waits for it for at most 5 s.
- The side drain (pushes, analytics, strikes) runs in the background through `ctx.waitUntil`. It starts after the rows drain that the DO queued before it.
- The alarm and `flushOutbox()` use the same chains. Load-test reset calls `flushOutbox()`.
- New slow logs, only at 1 s or more, with no user IDs or locations: `queue-do.slow-rpc`, `queue-do.slow-drain` and `queue.join.slow`.

## Verification

Tests in `apps/api/test/queue-do.test.ts`: a stuck Expo send does not hold `next` (it returns in less than 2 s, and the row is in D1). A concurrent flush does not send pushes twice.

The round-3 tail showed no DO RPC at 1 s or more and one slow row drain. The full run at 08:03Z was green: join p95 2654 ms, next p95 2247 ms, 316 pushes with no duplicates.

## Follow-ups

The slow joins left are Worker to DO round trips: `checkJoin` takes 600 to 730 ms, then `allocate` 0.4 to 1.8 s. Fold `checkJoin` into `allocate` to save one round trip for each join.

## Lessons

Put an upper limit on every wait for a shared resource inside a request. Send work that the caller does not need to the background.
