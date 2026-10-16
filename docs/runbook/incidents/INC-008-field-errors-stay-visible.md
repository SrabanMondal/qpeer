# INC-008: Field errors stayed visible after the value became valid

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S3 |
| Area | mobile |
| Status | fixed |
| Original ID | B4 |

## Summary

A field error stayed on screen after the user typed a valid value. Fields now re-validate on each change after a submit.

## Impact

Users saw an error for a value that was valid.

## Detection

The Step 1 device check found it. Commit da9edbc recorded it on 2026-10-15.

## Timeline

Unknown.

## Root cause

The forms validated only on submit.

## Fix

Commit 52aa5f6 (branch `fix/step1-polish`, merge 90e1ed0) added `useFieldErrors` in `apps/mobile/src/lib/form.ts`. After a submit, or while a field shows an error, each change re-validates that field. The business, queue name, queue settings, new queue, profile name and hours forms use it.

## Verification

The Step 2 device check re-checked it. Radius 20 showed a red error, and typing 150 cleared it.

## Follow-ups

None.

## Lessons

None beyond the fix.
