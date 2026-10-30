# INC-072: The List view missed businesses outside the map's box

| Field | Value |
|---|---|
| Date found | 2026-10-30 |
| Severity | S2 |
| Area | mobile, shared |
| Status | fixed |
| Original ID | Step 4 device check |

## Summary

The List showed only the businesses inside the map's current box, so Billu Barbar, about 10 km away, was missing at city zoom. The List now asks for its own box of about 25 km around the user (or the map centre when the location is unknown), whatever the map's zoom, and says "Within ~25 km of you". The map keeps its own box for the pills.

## Impact

A customer using the List could not find a business a few km outside the visible map area.

## Detection

Step 4 device check on 2026-10-30 (Samsung A9, preview APK EAS build `43cd96c6`, dev Worker).

## Timeline

2026-10-30: found during the device check and fixed the same day (times unknown).

## Root cause

The List and the map shared one `GET /v1/map` query, built from the map camera's bounds.

## Fix

- `packages/shared/src/map-view.ts`: `listBox(centre, radiusKm = 25)` makes a box of about the radius around the centre (centre snapped to a ~1 km grid so small pans reuse the query; each side clamped to the API's 1.5° limit through `clampMapBox`). `withinRadius` keeps only businesses within the radius (the box corners reach further).
- `apps/mobile/src/screens/discover/discover-screen.tsx`: in List mode the List query is used (the map query is off); in Map mode the map's own box. Rows are sorted as before (distance first when the location is known). Notices, empty and error states follow the visible view; the List header says "Within ~25 km of you" or "of the map centre".

Branch `fix/step4-device-findings`, fix commit `14ef30a`; merge commit unknown.

## Verification

`packages/shared/src/map-view.test.ts`, "listBox / withinRadius (List view reach)": a business ~10 km away is inside the box; the box passes `MapQuery`; a huge radius is clamped to 1.5° per side; small moves give the same box; `withinRadius` drops a business ~40 km away. `npm run check` and `expo export` green. Device check on 2026-10-30 with the preview APK (EAS build d9a4d731): the List header said "Within ~25 km of you" and showed Demo Clinic (1 m) and Billu Barbar (10 km).

## Follow-ups

- On the phone at city zoom: List shows Billu Barbar, sorted by distance.

## Lessons

None new.
