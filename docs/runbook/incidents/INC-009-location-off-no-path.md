# INC-009: Device location was off, and the app needed a "turn on location" path

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S3 |
| Area | mobile |
| Status | fixed-unverified-on-device |
| Original ID | B5 |

## Summary

During the Step 1 device check, the location switch on the phone was off. The walk-in GPS check of Step 2 needed a clear way for the user to turn location on. Step 2 added that path, but no device check of it is recorded.

## Impact

None at the time. Step 1 had no GPS check. Without the path, a customer with location off had no way to join a queue.

## Detection

The Step 1 device check noted it as B5. Commit da9edbc recorded it on 2026-10-15.

## Timeline

Unknown.

## Root cause

Not a bug. A design gap found before the feature existed.

## Fix

Commit dba77f0 (Step 2 mobile, merge ce42d4c) added `apps/mobile/src/lib/join-location.ts`. If `hasServicesEnabledAsync` is false, the join screen shows "Turn on location". It calls `enableNetworkProviderAsync`, else opens `LOCATION_SOURCE_SETTINGS`, else the app settings. The Step 3 map has the same path for the recenter button.

## Verification

The Step 2 device check joined with location already on. The location-off path on the join screen was not part of a recorded device check. The Step 3 device test script has this path at step 10, and it is not run yet.

## Follow-ups

Turn location off on the phone and join a queue. Make sure that "Turn on location" opens the system dialog.

## Lessons

None beyond the fix.
