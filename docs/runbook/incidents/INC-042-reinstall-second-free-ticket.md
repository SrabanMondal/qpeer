# INC-042: A reinstall can get a second free ticket in the same queue

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | api |
| Status | fixed-unverified-on-device |
| Original ID | B15 |

## Summary

The server allows one active ticket per user per queue. A walk-in user is a Firebase anonymous account. Firebase keeps that account on the phone. If a person uninstalls the app or clears its data, the phone gets a new anonymous account. That account can join the same queue again and get a second free ticket.

## Impact

One person can hold more than one walk-in ticket in a queue. The GPS walk-in check limits this to people at the business, and the no-show strike rule is per account, so a reinstall also clears strikes.

## Detection

The owner asked on 2026-10-16 how the app stores tickets for anonymous users. The review of that question found the gap. No user reported it.

## Timeline

Unknown.

## Root cause

The rule "one ticket per queue" uses the Firebase user id only. A device key on the phone has the same weakness, because Android deletes app data and Keystore keys on uninstall.

## Fix

Branch `feat/fix-batch-rebuild`, commits 8e17550 (shared schema), 610e9e8 (API, migration 0005, DO schema v2) and a7d3b3d (app). The app sends `deviceHash` = SHA-256(ANDROID_ID + a fixed app salt) with walk-in joins and device registration (`expo-application`, `@noble/hashes`). The raw id never leaves the phone. The server stores only the hash (D1 `tokens`, `free_lane_strikes`, `devices`; DO `tokens`). A second free walk-in join in the same queue from the same phone:

- same account → `409 already_in_queue` with its `tokenId` (as before);
- another account → `409 device_in_queue` (new code, no token id), with an app text that explains the one-ticket-per-phone rule.

Three no-shows on one device hash within 30 days block free joins for 7 days after the last one, whatever the account. A join without a hash (old builds) follows the old rules. Paid and staff flows ignore the hash.

The signed offline ticket from follow-up 2 is built in the same branch (C3, architecture doc §23).

## Verification

`apps/api/test/fix-batch.test.ts`: DO tests (device rule, paid flows, hash on the D1 row and strike) and API tests (409 codes and details, missing hash, invalid hash 400, device strike block 423). Not yet checked on a phone.

## Follow-ups

Device check: join, clear the app's data (or reinstall), join the same queue again → "This phone already has a ticket here".

## Lessons

An anonymous identity that lives in app storage does not survive a reinstall. Do not use it alone for fairness rules.
