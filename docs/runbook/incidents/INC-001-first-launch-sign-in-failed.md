# INC-001: First launch showed "No internet connection" at sign-in

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S2 |
| Area | mobile |
| Status | fixed |
| Original ID | Step 0 follow-up 1 |

## Summary

On the first launch after install, the app showed "Could not sign in: No internet connection". A restart fixed it. We added an automatic retry with backoff for the anonymous sign-in.

## Impact

A new user saw a sign-in error on the first launch and had to restart the app. Anonymous sign-in is the sign-in that the app does with no account (IDN-01).

## Detection

The Step 0 device check on the Samsung Galaxy A9 found it. Commit 794ed5e recorded it in `NOTES.md` under "Follow-ups found in Step 0".

## Timeline

The exact time is unknown. Commit 794ed5e added the note on 2026-10-15.

## Root cause

The cause of the first failure is unknown. Before the fix, the app had no automatic retry for the anonymous sign-in, so one failed attempt stopped the flow.

## Fix

Commit 5e9514c (merged in 60fd06a, Step 1 mobile) added a retry to `apps/mobile/src/lib/auth.tsx`. The app retries after 1, 2, 4 and 8 s, then every 15 s. It shows a "Connecting…" banner with a Retry button that does not block the screen.

## Verification

The Step 1 device check recorded "App recovers by itself when the network returns". Nobody reproduced the first-launch error after the fix.

## Follow-ups

None.

## Lessons

A network call at app launch needs a retry with backoff. One failed attempt must not end the flow.
