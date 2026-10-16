# INC-016: App process killed after quick taps on the hours screen

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S2 |
| Area | mobile |
| Status | watch |
| Original ID | B11 |

## Summary

One time, a burst of quick taps on the hours screen ended with the system killing the app process. Logcat showed no crash. We did not reproduce it.

## Impact

The app closed for the user. If the user had unsaved edits on the screen, the edits were lost. Whether that happened in this case is unknown.

## Detection

The Step 2 device check. Commit bd75aba recorded it on 2026-10-15.

## Timeline

Unknown.

## Root cause

Unknown.

## Fix

None.

## Verification

Not applicable.

## Follow-ups

If it happens again, save `adb logcat -b all` and `adb shell dumpsys activity exit-info com.qpeer.app` right after the kill. These show why the system killed the process.

## Lessons

When the system kills a process with no crash in logcat, record the exit info at once.
