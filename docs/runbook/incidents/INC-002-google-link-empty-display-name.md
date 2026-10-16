# INC-002: Google link left the display name empty

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S3 |
| Area | mobile |
| Status | fixed-unverified-on-device |
| Original ID | Step 0 follow-up 2 |

## Summary

When a user linked a Google account to the anonymous account, Firebase did not copy the Google name. The `displayName` stayed empty. The app now fills it from the Google profile after the link.

## Impact

A user who signed in with Google had no name in the app and on the backend (IDN-06).

## Detection

The Step 0 device check found it. Commit 794ed5e recorded it in `NOTES.md` under "Follow-ups found in Step 0".

## Timeline

Unknown. Commit 794ed5e added the note on 2026-10-15.

## Root cause

Firebase does not copy `displayName` when `linkWithCredential` links a provider to an existing user.

## Fix

Commit 5e9514c (merged in 60fd06a) changed `apps/mobile/src/lib/auth.tsx`. After a Google sign-in or link, if `displayName` is empty, the app calls `updateProfile` with the Google name. Then it force-refreshes the ID token, so the backend fills `display_name`.

## Verification

No device check of the Google link path after the fix is recorded. The Step 1 device check covered a name set by hand on the Profile screen only.

## Follow-ups

Link a Google account on the phone and make sure that the name shows on the Profile screen.

## Lessons

A provider link does not copy profile fields. Copy the fields that you need after the link.
