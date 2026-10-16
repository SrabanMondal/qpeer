# INC-032: Load test saw a token go from LEFT back to WAITING

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | loadtest harness |
| Status | fixed |
| Original ID | H1 |

## Summary

The full run failed "Terminal states never move backwards" with `b36f5dc3-a542-46be-99fd-50710c3b8adc: LEFT → WAITING`. The server state was right. A socket message sent before the leave reached the client after the HTTP answer to the leave. We added a revision number to each token view, and the client keeps the newest one.

## Impact

None on the server. The final DO state was LEFT, and the leave counts matched. The app had the same gap. See [INC-033](INC-033-app-ticket-out-of-order-view.md).

## Detection

Report `2026-10-16T07-39-06-823Z-full` (07:39Z UTC, 2026-10-16) and the round-3 tail capture.

## Timeline

Unknown beyond the run time.

## Root cause

It was not a stale D1 read and not a token that came back to life. The tail shows that the leave answered 200 in 336 ms, with the DO `leave` at 138 ms. `GET /v1/tokens/:id` reads the live view from the DO.

The simulator sorted all views of a token by arrival time. Any change in the queue re-sends near tokens their view on the socket. Socket and HTTP use separate connections, so a socket view from before the leave arrived after the leave answer.

## Fix

Branch `fix/step3_5-round3`, merged in 9e120b4:

- Commit bc04350 added `TokenView.rev` (the revision of that token, bumped on each change) and `newerTokenView()` in `packages/shared/src/queue.ts`.
- Commit ec07426 changed the simulator and checker. The shown view for each token is the one with the highest rev (`shownViews`). The checker ignores late views with a lower rev and fails if one rev ever shows two states.

## Verification

DO tests in `apps/api/test/queue-do.test.ts`: views carry `rev`, and the rev of the leave beats a WAITING view sent before it. Unit tests for `newerTokenView` in `packages/shared/src/queue.test.ts`. The full run at 08:03Z UTC was green on this check.

## Follow-ups

None.

## Lessons

A client that reads one object over two connections must order the updates by a server version, not by arrival time.
