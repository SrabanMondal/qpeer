# INC-052: An open ticket screen did not switch to the offline state

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | mobile |
| Status | open |
| Original ID | none |

## Summary

The ticket screen was open and live. The tester turned on airplane mode. After about 25 seconds the screen still showed "Last updated just now · reconnecting…", no offline strip, and an active "Leave queue" button. A cold start in airplane mode showed the offline state correctly (INC-040).

## Impact

A customer can tap Leave while offline and get an error instead of the clear "You're offline" reason. The saved ticket view itself stayed correct.

## Detection

Device check of the preview APK on 2026-10-16 (Samsung A9, Android 10).

## Timeline

Unknown.

## Root cause

Unknown. Probable: the offline state comes from failed HTTP requests, and the open ticket screen makes no HTTP request while its WebSocket reconnects.

## Fix

Not done. Also mark the app offline when the live socket cannot reconnect, or read the system network state (for example `@react-native-community/netinfo` or `expo-network`, which needs the next native build).

## Verification

Not yet.

## Follow-ups

None.

## Lessons

A screen that only uses a socket also needs to feed the shared offline state.
