# INC-013: `am force-stop` blocked alert delivery during tests

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S4 |
| Area | process |
| Status | benign |
| Original ID | Note in the Step 2 device check |

## Summary

During the alert tests, we stopped the app with `adb shell am force-stop`. After that, FCM did not deliver alerts to the app, and Android cleared its notifications. The app was not at fault. We now use `am kill`, which acts like a swipe-away.

## Impact

No user impact. A test result was wrong for a time: alerts looked broken when they were not.

## Detection

The Step 2 device check of background and cold-start alerts. Commit bd75aba recorded the note on 2026-10-15.

## Timeline

Unknown. The device check ran on 2026-10-15 and 2026-10-16.

## Root cause

Android behavior. A force-stopped app gets no FCM messages until the user opens it again. FCM (Firebase Cloud Messaging) is the service that carries push alerts to Android.

## Fix

A test rule, no code change. Test alerts with a swipe-away or `adb shell am kill com.qpeer.app`. Never use `am force-stop` for alert tests.

## Verification

With `am kill`, the cold-start test passed. The alert arrived, and a tap opened the app on the ticket. The `push_tickets` rows on the server showed `called` and `grace_started` with status `sent`.

## Follow-ups

None.

## Lessons

See "Testing alerts" in [lessons.md](../lessons.md).
