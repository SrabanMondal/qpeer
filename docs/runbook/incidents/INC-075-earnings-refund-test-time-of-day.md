# INC-075: The earnings test expected a refund in every 7-day window

| Field | Value |
|---|---|
| Date found | 2026-11-15 |
| Severity | S4 |
| Area | api |
| Status | fixed |
| Original ID | none |

## Summary

During UI redesign phase 1, `npm run check` failed one test twice in a row at about 22:00 IST: "totals reconcile with ledger_entries and with the paged list" (`apps/api/test/insights.test.ts`). It expected `totals.refunds > 0` for the 7-day range and got 0. At 22:02 IST the same test passed on `main` with no code change.

## Impact

None for users. No failing code was merged: the phase-1 branch did not touch `apps/api`, and the check was green when it was merged.

## Detection

The phase-1 subagent's `npm run check`, then a rerun by the orchestrator.

## Timeline

Unknown.

## Root cause

Same family as INC-074. The test seeds synthetic history that ends at the time the test runs. Whether a refund falls inside the last 7 days depends on the time of day.

## Fix

The test asserts `refunds > 0` only for the 28-day range. The totals for both ranges are still checked against `ledger_entries`.

## Verification

`npm run check` green (API 273, shared 178).

## Follow-ups

None.

## Lessons

1. The INC-074 lesson applies to every assertion on generated data relative to "now", not only to page counts. When fixing one, check the whole test for others.
