# INC-005: Offline launch stuck on "Starting…" with a token refresh loop

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S2 |
| Area | mobile |
| Status | fixed-unverified-on-device |
| Original ID | B1 |

## Summary

An offline launch with a signed-in user stayed on "Starting…". The app called `getIdToken` about two times each second with no backoff. We changed the start gate, the retry rules and the offline banner.

## Impact

With no network, a signed-in user did not get past the start screen. The phone made repeated token calls.

## Detection

The Step 1 device check on the Samsung Galaxy A9 found it. Commit da9edbc recorded it in `NOTES.md` on 2026-10-15.

## Timeline

Unknown.

## Root cause

The tabs gate waited for `/v1/me`. A `/v1/me` refetch with no data reset the query to `pending`. "Starting…" came back, the tabs unmounted, and the remounted screens refetched on mount. This made a loop of about 2 `getIdToken` calls each second.

## Fix

Commit 52aa5f6 on branch `fix/step1-polish`, merged in 90e1ed0 on 2026-10-15:

- The gate latches open. After the first failure or 2.5 s, the tabs open in Customer mode and switch when `/v1/me` arrives.
- `apps/mobile/src/lib/network.ts` retries network errors with backoff from 1 s to 30 s. It never retries a 4xx. It retries other errors two times.
- `apiFetch` maps an offline token refresh to `ApiError` with status `network`.
- `AppState` drives the TanStack Query focus and restarts stuck queries.
- `ConnectionBanner` is in every `Screen` and shows "Offline — reconnecting…" until a request succeeds.

## Verification

The Step 2 device check passed an airplane-mode test on the ticket screen. The app reconnected in about 35 s. That test did not cover a cold start with no network. No device record of an offline cold start after the fix exists.

## Follow-ups

Start the app in airplane mode while signed in. Make sure that the tabs open and the offline banner shows.

## Lessons

A start gate must not depend on a query that can return to `pending`. Latch the gate open.
