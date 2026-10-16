# INC-044: The "Show public stats" switch was drawn squashed

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | mobile |
| Status | open |
| Original ID | B17 |

## Summary

On the owner business screen, the "Show public stats" switch was drawn as a narrow sliver with a dark knob. The off state was almost invisible. The switch worked: D1 `businesses.public_stats` changed from 0 to 1 and back to 0.

## Impact

An owner cannot see the state of the switch, and can miss the switch.

## Detection

Step 3 device check on 2026-10-16 (Samsung A9, Android 10).

## Timeline

Unknown.

## Root cause

Unknown. The long description text next to the switch probably takes the full row width, and the switch gets too little space.

## Fix

Not done. Give the switch a fixed width that does not shrink, and make sure that the off track has enough contrast in dark mode.

## Verification

Not yet.

## Follow-ups

Check every other switch in the app (for example the hours "Closed" switch) for the same layout.

## Lessons

None yet.
