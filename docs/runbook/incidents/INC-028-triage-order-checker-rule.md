# INC-028: Checker flagged a skipped triage token behind a lower class

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | loadtest harness |
| Status | benign |
| Original ID | G1 (checker rule) |

## Summary

The baseline run failed "Queue order consistent" with `0f5e01d7-d58c-4e90-bf0d-8bd0725c6209 console: triage #1 after a lower class`. The token was a skipped triage token. A skip legally puts a token behind the next 3 people, regulars too. The class check did not know the skip rule.

## Impact

None for this finding. The investigation found a real bug. See [INC-029](INC-029-skipped-regular-in-triage-range.md).

Triage is the priority class that staff add for urgent cases. Triage tokens go before regular tokens.

## Detection

Report `2026-10-16T06-56-16-323Z-baseline` (06:56Z UTC, 2026-10-16).

## Timeline

- 06:56Z: baseline RED on this check.
- 07:29Z: baseline green after the fix (`2026-10-16T07-29-06-172Z-baseline`).

## Root cause

The simulator skips random waiting tokens, triage tokens too. Skip means "behind the next 3 people or the end" (architecture §23). The FIFO check had an exemption for skipped tokens. The class check did not.

## Fix

Commit 538d6de on branch `fix/step3_5-round2`, merged in 8ed5c43, changed `scripts/loadtest/lib/check.ts`. A skipped or undone token can sit behind a lower class. It still counts for the order of the tokens after it.

## Verification

The order check passed in the baseline runs at 07:29Z and 07:58Z and in the full run at 08:03Z.

## Follow-ups

None.

## Lessons

Every exemption in one invariant check must also apply to the related checks. An invariant is a rule that must hold at all times.
