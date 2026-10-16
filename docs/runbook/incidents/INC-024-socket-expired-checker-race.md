# INC-024: Socket showed EXPIRED while the audit showed GRACE

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | loadtest harness |
| Status | benign |
| Original ID | F3 (checker race) |

## Summary

The full run failed "WebSocket clients converge to the DO state" for one token: `dfbe6ad0-ba12-4428-bede-9b0499fe1fec: socket state EXPIRED != DO GRACE`. The socket was right. The checker compared it with an audit that was a minute old.

## Impact

None. The product sent the correct state.

## Detection

Report `2026-10-16T06-26-44-140Z-full` and the tail capture.

## Timeline

All times UTC on 2026-10-16:

- 06:32:01: staff marked the token as a no-show. Grace was 1 minute. Grace is the time a called customer has to arrive.
- 06:32:58: the checker audited this queue and read GRACE.
- 06:33:02: the alarm expired the grace. The DO sent EXPIRED to the socket.
- Later: the checker read the socket after it audited the other queues, `/v1/map` and sampled GETs.

## Root cause

A race in the checker. The socket was ahead of the old audit.

## Fix

Commit ca634e0 on branch `fix/step3_5-findings`, merged in 0b5d7eb. The checker re-checks a mismatch against a new audit, 3 s apart, for two rounds.

## Verification

A unit test in `apps/api/test/queue-do.test.ts` ("F3: grace expiry on the alarm is pushed to the token's socket"). The converge check passed in all later runs.

## Follow-ups

None. The same queue showed a real bug. See [INC-025](INC-025-far-fanout-alarm-spin.md).

## Lessons

Compare live state with an audit taken at the same time, or re-audit before you call it a mismatch.
