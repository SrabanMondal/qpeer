# INC-039: Chained adb taps drifted and nearly hit Deactivate

| Field | Value |
|---|---|
| Date found | unknown (between 2026-10-14 and 2026-10-16) |
| Severity | S4 |
| Area | process |
| Status | fixed |
| Original ID | none |

## Summary

During a device check, we sent several `adb shell input tap` commands in a row with no screenshot between them. The screen changed under the taps, and one tap opened the Deactivate dialog of the business. We cancelled the dialog. No harm was done.

## Impact

No harm. A tap on the Deactivate button inside that dialog deactivates the business.

## Detection

The Deactivate dialog opened. How we saw it is unknown.

## Timeline

Unknown.

## Root cause

Tap coordinates came from an old screenshot. The layout moved after an earlier tap.

## Fix

A rule, no code change. Take a screenshot before every tap.

## Verification

Not applicable.

## Follow-ups

None.

## Lessons

See "Phone handling" in [lessons.md](../lessons.md).
