# INC-007: Business header was cramped

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S3 |
| Area | mobile |
| Status | fixed |
| Original ID | B3 |

## Summary

On the Business tab, the "Business" mode toggle label ran into the "My businesses" title. The toggle is now a compact pill.

## Impact

The header text overlapped on the phone.

## Detection

The Step 1 device check found it. Commit da9edbc recorded it on 2026-10-15.

## Timeline

Unknown.

## Root cause

The toggle and the title shared the header with no width limit.

## Fix

Commit 52aa5f6 (branch `fix/step1-polish`, merge 90e1ed0). The title is left-aligned and truncates. The mode toggle is a compact outlined pill in `headerRight`, with a smaller track and caption font scaling capped at 1.2×.

## Verification

The Step 2 device check re-checked it and recorded "compact Business pill".

## Follow-ups

None. The dev-build "Tools" gear still overlaps this pill. See [INC-017](INC-017-dev-tools-gear-overlaps-pill.md).

## Lessons

None beyond the fix.
