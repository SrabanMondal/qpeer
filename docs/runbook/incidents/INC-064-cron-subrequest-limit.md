# INC-064: A busy scheduled run could pass the free-plan subrequest limit

| Field | Value |
|---|---|
| Date found | 2026-10-30 |
| Severity | S2 |
| Area | api |
| Status | fixed |
| Original ID | none (found by review 2026-10-30) |

## Summary

The Workers free plan allows 50 external subrequests per invocation, and a cron run is one invocation. The quarter-hour run makes Razorpay calls in `recover_orders` (up to 15 orders, each a lookup and maybe a capture and a refund) and in `refunds` (up to 40 refunds, each two calls and a push), and at 21:30 UTC the daily `reconcile` runs in the same invocation (INC-056). A busy run could ask for well over 50. Now one scheduled run has one call budget of 40, shared by all its jobs; when it is used up the jobs stop cleanly and the next run continues.

## Impact

No user impact: test mode only, low volume. In production, past the limit every further `fetch` throws. Refunds and recoveries would fail half-way, count as provider failures (backoff, `refund_failed` and later `refund_stuck` error logs), and the daily reconcile could lose its provider scan for the day. A customer whose money was due back would wait longer for no reason.

## Detection

Review on 2026-10-30 of the cron jobs after INC-056 merged the daily schedule into the quarter-hour trigger.

## Timeline

2026-10-30: found and fixed the same day (UTC times unknown).

## Root cause

Each job had its own item limit (15 orders, 40 refunds, 5 list pages), but nothing counted the calls of one invocation across jobs. The per-invocation limit counts every outbound `fetch`, whatever job makes it.

## Fix

`apps/api/src/lib/call-budget.ts` adds `CallBudget`. `runScheduled` (`apps/api/src/cron/jobs.ts`) makes one budget of `CRON_CALL_BUDGET` = 40 per run and passes it to every job; `PayCtx.budget` carries it, and `withBudget` (`razorpay.ts`) counts every Razorpay call. The `refund_issued` push of a refund counts too and is skipped when nothing is left. The other 10 subrequests are headroom (the hourly push-receipt call and later additions).

- Order of work: `recover_orders` (a customer paid and has no ticket), then `refunds`, then the daily `reconcile`. At 21:30 UTC the quarter-hour jobs may spend at most 40 − `RECONCILE_RESERVE` (15) = 25, so the once-a-day provider scan always gets its calls. Inside `reconcile` the provider scan now runs before its own due-refunds step.
- When the budget can't pay for the next item, a job stops before it calls Razorpay: a refund needs 2 calls left, an order lookup 1. A call refused by the budget throws `BudgetSpent`, which is never a provider failure: no `refund_attempts`, no backoff, no error log; a refund's lease is given back. Recovery doesn't rotate an order it could not ask about, so the next run asks about it first.
- Each job's result has `deferred` (items left for the next run). The run writes one `info` line `call_budget_used_up` with the limit, the calls used and the deferred count per job, only when something was deferred.
- HTTP requests carry no budget (a request makes a few calls).

Branch `fix/payments-followups`, fix commit `f67b603`; merge commit unknown.

## Verification

`apps/api/test/payments-budget.test.ts`: a run with 30 due refunds and 20 open orders makes ≤ 40 calls, logs one info line and no error, counts no refund failure, and the next runs finish the rest (all 30 refunded once, all 20 orders looked up); the 21:30 run with the same load plus two old wrong-amount payments stays ≤ 40 and the reconcile scan still completes and refunds both. `npm run check`.

## Follow-ups

- If `reconcile` is ever cut short, its scan is not resumed until the next day (the 24 h window then misses the oldest hours). An alert on `"event":"call_budget_used_up"` with `reconcile` in `deferred` would show it; a resumable scan needs a small state row in D1.
- Recheck the numbers before moving to the paid plan (a much higher limit) or adding outbound calls to a cron job.

## Lessons

A per-invocation platform limit needs a per-invocation budget shared by every job of that invocation; per-job item limits don't add up to one.
