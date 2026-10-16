# INC-041: The app did not handle a failed map load

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | mobile |
| Status | open |
| Original ID | B14 |

## Summary

When the phone was offline, Mapbox could not load the map style. The dev build showed the raw error in a red bar: `Mapbox [error] RNMBXMapView | Map load failed: Failed to load style 'mapbox://styles/mapbox/dark-v10': Online connectivity is disabled.` The bar stayed after the phone came back online.

## Impact

The red bar is the React Native dev error overlay (LogBox). Release builds do not show it. The real gap is that the app has no handler for a failed map load, so the user sees a black map with no reason.

## Detection

The owner saw it during the device check on 2026-10-16.

## Timeline

Unknown.

## Root cause

`queue-map.tsx` does not handle the Mapbox load error event. Mapbox logs the error with `console.error`, and LogBox shows every `console.error` in a dev build.

## Fix

Not done. Handle the map load error: show the offline map card from INC-040, retry the style when the network comes back, and log the error as a warning.

## Verification

Not yet.

## Follow-ups

Fix together with INC-040.

## Lessons

Every native view that loads data from the network needs an error state in the app.
