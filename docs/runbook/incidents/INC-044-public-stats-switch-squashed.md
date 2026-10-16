# INC-044: The "Show public stats" switch was drawn squashed

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | mobile |
| Status | fixed-unverified-on-device |
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

Probable, not proven on the phone: the long description took the row's width (`flex: 1` text next to a switch that may shrink), so Android drew the switch narrow. The off track used the `border` colour, which is almost the card colour in dark mode, and the knob used the card colour.

## Fix

Branch `feat/fix-batch-rebuild`, commit 03b4107. New `AppSwitch` (labelled row: the text takes the free width and wraps, the switch sits in a box that never shrinks; the whole row toggles) and `ThemedSwitch` (bare switch, same colours). Off track `inkMuted` in both themes, knob white when on and `ink`/`card` when off. Used by "Show public stats" and the hours editor's day switches, the only two switches in the app.

## Verification

Types and Biome. Not yet checked on a phone.

## Follow-ups

Device check in dark and light theme and at the largest font size.

## Lessons

None yet.
