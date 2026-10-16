# INC-041: The app did not handle a failed map load

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | mobile |
| Status | fixed |
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

Branch `feat/fix-batch-rebuild`, commit b691163. `queue-map.tsx` handles `onMapLoadingError` (style errors only; tile errors keep the cached map) and logs it with `console.warn`. A Mapbox `Logger` callback turns Mapbox's own network load errors into warnings, so LogBox shows no red bar. The Home screen then shows the offline card from INC-040 ("The map can't load" when online). When requests succeed again (`onBackOnline`), or on "Try again", the map view remounts and loads the style again.

## Verification

Types and a JS bundle build. Device check on 2026-10-16 with the preview APK: a cold start in airplane mode showed the offline card and no raw error. The dev-build LogBox path is not checked on a phone.

## Follow-ups

Device check: start the app with no network, then turn the network on.

## Lessons

Every native view that loads data from the network needs an error state in the app.
