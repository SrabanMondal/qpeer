# INC-040: Offline experience was inconsistent and the map had no fallback

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S2 |
| Area | mobile |
| Status | open |
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

Not done. The agreed direction is to degrade, not block:

1. One slim offline banner on every screen.
2. The ticket screen keeps the last known view and shows "Last updated N min ago".
3. The map screen shows a calm card: "The map needs internet", with a link to the active tickets.
4. Actions that need the server (Join, Leave, NEXT, Skip, saves) are disabled with a short reason.
5. The console keeps the last state, greyed, with "Offline — actions paused".

The app keeps tickets in memory only. A cold start while offline therefore has nothing to show. Saving the ticket on the phone needs a storage module and a native rebuild (see the "Finish" list in `NOTES.md`).

## Verification

Not yet.

## Follow-ups

1. Build the offline states above.
2. Save the last ticket view on the phone in the batched native rebuild.

## Lessons

Design the offline state of every screen together, not one screen at a time.
