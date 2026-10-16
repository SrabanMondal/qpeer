# INC-023: Serial outbox drain made bursts and close slow

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | queue engine |
| Status | fixed |
| Original ID | F2 (server slowness) |

## Summary

The outbox drain did one D1 round trip for each item, and two for each push, one after the other. Every mutating RPC waited for the shared drain. A burst of 25 joins finished all together after about 3 s. Close and pause with about 40 to 100 tokens took 4 to 13 s. We batched the drain.

## Impact

Customers and staff waited seconds for join, close and pause under load. The outbox is the DO table of writes that wait to go to D1 or to push.

## Detection

The investigation of F2 timeouts in the runs at 06:21Z and 06:26Z on 2026-10-16 (UTC), with the `wrangler tail` capture.

## Timeline

- 06:21Z and 06:26Z: RED runs.
- 06:56Z and 06:59Z: runs after the fix. Join p95 was 2533 ms and 2264 ms. Before the fix it was 10000 ms and 3528 ms, but client connect timeouts ([INC-022](INC-022-client-connect-timeouts.md)) set the 10000 ms value.

## Root cause

`apps/api/src/queue/outbox.ts` applied items one at a time. Every mutating RPC awaited the drain.

## Fix

Commit 13b9751 on branch `fix/step3_5-findings`, merged in 0b5d7eb:

- Rows (`token_upsert` and `snapshot`) go in one D1 batch per round.
- Pushes go in one `sendAlerts` call: one device lookup, one Expo send, one ticket batch.
- Join reads the business and the queues in parallel.
- The first-sight user insert uses `RETURNING`.

## Verification

Tests in `apps/api/test/queue-do.test.ts`: a burst of 30 joins has every D1 row when each join returns. Close sends 30 alerts once each in a batch and removes one dead device. The join p95 values are above.

## Follow-ups

The drain was still one serial chain. See [INC-030](INC-030-slow-join-after-allocation.md).

## Lessons

Do not make every RPC wait for one serial chain of network writes. Batch the writes.
