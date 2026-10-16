# INC-015: Console Undo bar and lists sat below the fold

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S3 |
| Area | mobile |
| Status | fixed |
| Original ID | B10 |

## Summary

On a small screen, the queue console put the Undo bar and the lists below the fold. Staff had to scroll to undo a Next. The layout is now more compact.

## Impact

Staff had to scroll to reach Undo, which is open for 30 seconds only.

## Detection

The Step 2 device check found it. Commit bd75aba recorded it on 2026-10-15.

## Timeline

Unknown.

## Root cause

The Now Serving block was tall, and the Undo bar was part of the scroll content.

## Fix

Commit 500d79f (branch `fix/clock-console`, merge 13806ab) changed `apps/mobile/src/screens/queue-console.tsx`. Now Serving is a compact row. Called, with Served and No-show, is right under it. The Undo bar floats above the tab bar.

## Verification

Device check on 2026-10-16 (Samsung A9, Android 10): the console showed the status card, Now Serving, the Called card with Served and No-show, and NEXT above the fold without a scroll. The Undo bar did not show because no Next was pressed in the last 30 seconds.

## Follow-ups

None.

## Lessons

None beyond the fix.
