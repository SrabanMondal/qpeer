# INC-014: Fast phone clock broke countdowns

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S2 |
| Area | mobile |
| Status | fixed |
| Original ID | B9 |

## Summary

The test phone clock was about 11.5 minutes fast. The app computed countdowns with the phone clock. A fresh 10-minute grace showed "Time is up — expiring" at once. The app now uses a server-corrected clock and blocks use when the phone clock is wrong by more than 2 minutes.

## Impact

A customer saw a wrong grace countdown and a "Joined" time that did not match the status bar. Grace is the time a called customer has to arrive after a no-show.

## Detection

The Step 2 device check found it. Commit bd75aba recorded it on 2026-10-15.

## Timeline

Unknown.

## Root cause

The app compared server times with `Date.now()` on the phone. The phone clock was not set to automatic time.

## Fix

Commit 500d79f on branch `fix/clock-console`, merged in 13806ab on 2026-10-16:

- `/v1/health` returns `serverTime` (`apps/api/src/app.ts`).
- The app measures the offset at startup, on foreground, and on "Check again" (`apps/mobile/src/lib/clock.ts`, shared `packages/shared/src/clock.ts`).
- All countdowns use `serverNow()`.
- `apps/mobile/src/components/clock-guard.tsx` shows a "Your phone's time is wrong" popup when the offset is more than 2 minutes.

## Verification

Unit tests in `packages/shared/src/clock.test.ts` and `apps/api/test/api.test.ts`.

Device check on 2026-10-16 (Samsung A9, Android 10, phone clock 691 s fast, automatic time off):

1. The app opened with the popup "Your phone's clock is about 12 minutes ahead."
2. "Open date & time settings" opened `DateTimeSettingsActivity` directly.
3. The owner turned on automatic time and went back to the app. The popup closed without a tap. The phone clock then matched the laptop clock to the second.

## Follow-ups

None.

## Lessons

Never compare a server time with the device clock. Use a server-corrected clock for every countdown.
