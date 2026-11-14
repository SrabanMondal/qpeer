# INC-074: The earnings paging test failed at some times of day

| Field | Value |
|---|---|
| Date found | 2026-11-14 |
| Severity | S4 |
| Area | api |
| Status | fixed |
| Original ID | none |

## Summary

After the Step 5 merge, `npm run check` on `main` failed one test: "totals reconcile with ledger_entries and with the paged list" (`apps/api/test/insights.test.ts`). For the 7-day range it expected more than one page of 25 events and got one page. The same test passed on the branch earlier the same day.

## Impact

None for users. `main` was pushed with a failing test for a few minutes, because the merge command chained `git push` after `npm run check` with `;` instead of `&&`.

## Detection

The orchestrator's check after the merge, at 20:44 IST on 2026-11-14.

## Timeline

Unknown.

## Root cause

The test seeds synthetic history that ends at the time the test runs. How many money events fall inside the last 7 days depends on the time of day. In the evening there were fewer than 26, so the list fit on one page.

## Fix

The 7-day case pages with `limit=1`, so paging is always covered. The 28-day case keeps `limit=25`. The endpoint and the data were correct.

## Verification

`npm run check` green (API 273, shared 178).

## Follow-ups

None.

## Lessons

1. A test that uses generated data relative to "now" must not depend on how much of it falls in a window.
2. Chain `git push` after a check with `&&`, never `;`.
