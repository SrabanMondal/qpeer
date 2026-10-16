# INC-040: Offline experience was inconsistent and the map had no fallback

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S2 |
| Area | mobile |
| Status | fixed-unverified-on-device |
| Original ID | B13 |

## Summary

The phone had no network when the app started. Home showed an "Offline — reconnecting…" banner, a "Loading queues…" card with a spinner, and a black area where the map was. Each screen handles offline in its own way. The owner asked for one clear offline state.

## Impact

A customer without signal sees a broken-looking screen instead of a clear message. A customer in a queue needs the ticket most when the signal is weak, for example inside a hospital.

## Detection

The owner saw it during the device check on 2026-10-16. Wi-Fi was off and mobile data had no active network (`Active default network: none`).

## Timeline

Unknown.

## Root cause

The app has a shared `ConnectionBanner`, but each screen adds its own loading and error states. The map screen has no state for "the map style cannot load".

## Fix

Branch `feat/fix-batch-rebuild`, commits b26237c (storage module in the native rebuild) and b691163 (offline screens). Degrade, do not block:

1. `ConnectionBanner` is now one slim strip on every screen: "Offline — showing saved info" with Retry (or "Connecting…").
2. A new `lib/storage.ts` (AsyncStorage, typed keys with versions) saves every ticket view. The ticket screen shows the saved view when the server can't answer, also on a cold start, with "Last updated N min ago · offline".
3. Home shows a calm card, "The map needs internet", with the saved active tickets one tap away, instead of a spinner and a black map (also when the map style fails, INC-041).
4. Server actions are disabled with "You're offline. This needs internet.": Join, Leave, every console action, and the save buttons (`Button needsNetwork`).
5. The console keeps the last state, greyed, under "Offline — actions paused".
6. The Queue tab lists the saved active tickets when the server can't answer.

## Verification

`npm run check` (types, Biome, API and shared tests). The screens are app code without unit tests; checked by a JS bundle build (`expo export`). Not yet checked on a phone.

## Follow-ups

Device check on the rebuilt app: airplane mode on the ticket, on Home and on the console; then a cold start in airplane mode.

## Lessons

Design the offline state of every screen together, not one screen at a time.
