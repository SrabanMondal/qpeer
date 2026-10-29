# INC-066: The load-test fairness check counted priority calls with no regular waiting

| Field | Value |
|---|---|
| Date found | 2026-10-30 |
| Severity | S4 |
| Area | loadtest harness |
| Status | fixed |
| Original ID | none |

## Summary

The cloud baseline on the final Step 4 code failed "Credit counter fairness (PRI-06)": queue `a32c058e…` had 2 priority calls against 1 regular call with N = 2 (report `scripts/loadtest/reports/2026-10-29T18-48-47-250Z-baseline.md`). All other checks were green.

## Impact

None for users. The run was red for a harness reason.

## Detection

Cloud baseline run on 2026-10-29 at 18:48 UTC.

## Timeline

Unknown.

## Root cause

The engine calls the priority head when no regular is waiting, even if its credits are below N (`nextLane` in `packages/shared/src/priority.ts`). Without this, a paid holder would wait at an idle counter. The checker counted every priority call of the session, so a priority call made while no regular waited looked like an unfair call.

## Fix

`fairnessFailures` in `scripts/loadtest/lib/check.ts` counts only priority calls made while a regular token was WAITING (joined before the call, and not yet called or ended). The limit stays: such calls ≤ regular calls ÷ N + 1. The checker's `DoToken` type now declares `joinedAt` and `endedAt`, which the audit already returned.

## Verification

Cloud baseline rerun on 2026-10-30.

## Follow-ups

The owner decided "if no priority person is waiting, regulars proceed normally" (2026-10-18). The mirror rule (a priority holder is called when no regular waits) is engine behaviour; confirm it with the owner and record it in architecture §23.

## Lessons

A fairness invariant must only count the choices where both lanes were waiting.
