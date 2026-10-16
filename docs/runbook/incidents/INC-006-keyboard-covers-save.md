# INC-006: Keyboard covered the Save button

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S3 |
| Area | mobile |
| Status | fixed |
| Original ID | B2 |

## Summary

On the profile name editor, the keyboard covered the Save button. Forms now scroll the focused field and its button into view.

## Impact

A user had to close the keyboard to find Save.

## Detection

The Step 1 device check found it. Commit da9edbc recorded it on 2026-10-15.

## Timeline

Unknown.

## Root cause

The forms had no keyboard-aware scrolling.

## Fix

Commit 52aa5f6 (branch `fix/step1-polish`, merge 90e1ed0). `Screen` wraps scroll content in `KeyboardAvoidingView` (padding, offset equal to the header height). When the keyboard opens, it scrolls the focused field plus about 88 dp into view.

## Verification

The Step 2 device check re-checked it: the keyboard kept the field and Save visible.

## Follow-ups

None.

## Lessons

None beyond the fix.
