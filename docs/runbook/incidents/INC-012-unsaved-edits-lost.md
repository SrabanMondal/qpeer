# INC-012: Leaving a form discarded unsaved edits with no warning

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S2 |
| Area | mobile |
| Status | fixed |
| Original ID | B8 |

## Summary

When a user left a form with unsaved edits, the app discarded the edits with no warning. The app now asks "Discard changes?".

## Impact

An owner lost typed changes to a business, hours or queue settings after a back press.

## Detection

The Step 1 device check found it. Commit da9edbc recorded it on 2026-10-15.

## Timeline

Unknown.

## Root cause

The forms had no guard for back navigation.

## Fix

Commit 52aa5f6 (branch `fix/step1-polish`, merge 90e1ed0) added `useUnsavedChangesGuard(dirty)` in `apps/mobile/src/lib/unsaved-changes.ts`. It uses `usePreventRemove` from `expo-router/react-navigation` and asks "Discard changes?" with Keep editing and Discard. `allowLeave()` skips the question after a successful save. The profile name field is inside a tab, so it uses `useBackPressGuard` on the Android back button.

## Verification

The Step 2 device check re-checked it: "Discard changes?" showed on back.

## Follow-ups

None.

## Lessons

None beyond the fix.
