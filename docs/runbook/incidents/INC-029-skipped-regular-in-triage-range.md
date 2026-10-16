# INC-029: A skip put a regular token inside the triage range

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S2 |
| Area | queue engine |
| Status | fixed |
| Original ID | none (found while investigating G1) |

## Summary

While we investigated [INC-028](INC-028-triage-order-checker-rule.md), the audit showed a real bug in the queue engine. In two cases, a skip put a regular token among the triage tokens. Every later triage arrival then queued behind it. A skip now never moves a token into the range of a higher class.

## Impact

In those cases, a triage customer waited behind a skipped regular customer. Triage is the priority class for urgent cases. No real customer saw it, because the engine was not in use yet.

## Detection

The audit of the queue in the baseline run at 06:56Z UTC on 2026-10-16 (`2026-10-16T06-56-16-323Z-baseline`).

## Timeline

Unknown beyond the run time.

## Root cause

`skipSortKey` in `apps/api/src/queue/ordering.ts` computed the new place by position only. Two cases broke the class order:

1. A CALLED regular token re-entered "behind the first 3 waiting", and those 3 were triage tokens.
2. A skip "to the end" took the rank of the last waiting token when only triage tokens were waiting.

## Fix

Commit 15a49f7 ("fix: keep skipped tokens out of higher class ranges") on branch `fix/step3_5-round2`, merged in 8ed5c43. A skip moves a token at most to the head of its own class.

## Verification

Tests in commit 538d6de, `apps/api/test/queue-do.test.ts`:

- "G1: a skipped triage token goes behind the next 3 people, even regulars". A new triage still goes first.
- "G1: a skipped regular never lands inside the triage range", for both cases. It fails without the fix.

The order check passed in all later cloud runs.

## Follow-ups

None.

## Lessons

A position rule ("behind the next 3") must keep the class rule. Test the edge where all the people in range are of a higher class.
