# INC-015: Console Undo bar and lists sat below the fold

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S3 |
| Area | mobile |
| Status | fixed-unverified-on-device |
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

Not yet checked on a phone.

## Follow-ups

Open the console on the Samsung Galaxy A9 and make sure that Undo and the Called list show without a scroll.

## Lessons

None beyond the fix.
