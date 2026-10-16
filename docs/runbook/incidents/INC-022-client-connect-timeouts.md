# INC-022: Load-test client timeouts that never reached the Worker

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | loadtest harness |
| Status | fixed |
| Original ID | F2 (cause a) |

## Summary

The first baseline run failed "No unexpected responses" with status 0 on joins and on `/me/devices`. All of the about-10-second timeouts were connect timeouts in the Node client. The Worker never saw them. The simulator now retries connect failures and names the cause of each failure.

## Impact

No user impact. The load test reported failures that were on the client link.

## Detection

Report `2026-10-16T06-21-35-955Z-baseline`: `POST /queues/:id/join → 0 × 2` and `POST /me/devices → 0 × 1`. The full run at 06:26Z had more.

## Timeline

- 06:21Z (UTC), 2026-10-16: baseline RED.
- 06:26Z: full RED.

## Root cause

The 10.0 to 10.6 s timeouts match the 10 s connect timeout of Node `fetch`. The laptop used a Jio mobile link with a round trip of about 170 ms to the Cloudflare NRT location. Some requests never got a connection.

Analytics joins, simulator joins and DO tokens per queue were equal in both runs. No timed-out join made a hidden token.

One join reached the Worker and hung for 19.5 s with no DO RPC and no log line. This matches a stalled request body on the same link. We did not reproduce it on the server.

## Fix

Commit ca634e0 on branch `fix/step3_5-findings`, merged in 0b5d7eb, changed `scripts/loadtest/lib/{http,sim,check,model,report}.ts`:

- The simulator retries a connect failure up to 2 times and counts it as "client connect retries".
- The simulator retries a join with status 0 once. An `already_in_queue` answer then leads to `GET /tokens/:id`, and that token counts as the join.
- The simulator retries `/me/devices` once.
- A 20 s timeout still counts as unexpected. The report prints the cause: `timeout`, `connect`, `network:<code>` or `bad_body`.

## Verification

The runs at 06:56Z and 06:59Z printed the causes. Later fixes in [INC-034](INC-034-client-network-failures.md) moved connect failures to their own check.

## Follow-ups

None.

## Lessons

Separate client network failures from server errors in a load test. Otherwise a bad link looks like a server bug.
