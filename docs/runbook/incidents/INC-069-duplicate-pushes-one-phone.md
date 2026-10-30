# INC-069: Every alert arrived twice on one phone

| Field | Value |
|---|---|
| Date found | 2026-10-30 |
| Severity | S2 |
| Area | api |
| Status | fixed-unverified-on-device |
| Original ID | Step 4 device check |

## Summary

The test phone had two Expo push tokens registered for the same user: one from the old development build and one from the new preview APK, both with the same device hash. Every alert went to both, so the phone showed it twice. `POST /v1/me/devices` with a `deviceHash` now removes the user's older registrations with the same hash and keeps the newest.

## Impact

The tester saw every push twice. In production a customer who reinstalls or updates to a build with a new push token would get double alerts.

## Detection

Step 4 device check on 2026-10-30 (Samsung A9, preview APK EAS build `43cd96c6`, dev Worker): `grace_started`, `missed` and "Refund issued" pushes each arrived twice.

## Timeline

2026-10-30: found during the device check and fixed the same day (times unknown).

## Root cause

`devices` is keyed by the Expo push token. A new build on the same phone gets a new token, and the old app never signed out, so its row stayed. Alerts go to every device row of the user.

## Fix

`apps/api/src/modules/notifications/service.ts`, `upsertDevice`: after the upsert, when the body has a `deviceHash`, delete the rows of the same user and the same `deviceHash` with another token. Rows without a hash (older builds) and other users' rows on the same phone are not touched.

Branch `fix/step4-device-findings`, fix commit `e44e29e`; merge commit unknown.

## Verification

`apps/api/test/queue-api.test.ts`, "POST /me/devices with a deviceHash → older tokens of the same user and phone are removed; others stay": old token removed, newest kept (also after a refresh), a token without a hash and another user's token on the same phone kept. `npm run check` green. Not yet tried on a phone.

## Follow-ups

- After deploying, open the app once on the A9 (it re-registers) and check that one push arrives per alert.

## Lessons

None new.
