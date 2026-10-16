# INC-042: A reinstall can get a second free ticket in the same queue

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | api |
| Status | open |
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

Not done. Proposed fix: the app sends a hash of `ANDROID_ID`. Android keeps this id for the app across reinstalls and resets it only on a factory reset. The server stores only the hash with each walk-in ticket. A second walk-in join in the same queue with the same hash returns `already_in_queue`. Strikes also count per device hash.

## Verification

Not yet.

## Follow-ups

1. Add the device hash to the join request and the token row.
2. Later, with the batched native rebuild: a server-signed ticket saved on the phone. The app shows it offline, and staff can scan it to prove it is real.

## Lessons

An anonymous identity that lives in app storage does not survive a reinstall. Do not use it alone for fairness rules.
