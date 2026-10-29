# INC-056: The loadtest deploy hit the free-plan cron trigger limit

| Field | Value |
|---|---|
| Date found | 2026-10-29 |
| Severity | S4 |
| Area | tooling |
| Status | fixed |
| Original ID | none |

## Summary

Step 4 added a third cron trigger (`30 21 * * *`, daily reconciliation). After the `dev` deploy, `wrangler deploy --env loadtest` uploaded the code but failed to register its schedules: "A request to the Cloudflare API (…/schedules) failed", with a link to the account plan limits.

## Impact

The loadtest Worker ran without cron triggers. The `demo` Worker (Step 5) would hit the same limit.

## Detection

Deploy output on 2026-10-29.

## Timeline

Unknown.

## Root cause

The Workers free plan allows 5 cron triggers per account. Each env declared 3 triggers, so `dev` (3) plus `loadtest` (3) needed 6.

## Fix

Each env now declares only `*/15 * * * *`. `runScheduled` in `apps/api/src/cron/jobs.ts` uses `dueSchedules()`: the quarter-hour run also runs the hourly jobs at minute 0 UTC and the daily jobs at 21:30 UTC. A direct hourly or daily trigger still runs only its own jobs. Test: "cron dispatch on one trigger (INC-056)" in `apps/api/test/queue-api.test.ts`. Three envs now use 3 triggers.

## Verification

`npm run check`; both Workers redeployed with one schedule each.

## Follow-ups

None.

## Lessons

Count cron triggers across all envs of the account before adding one.
