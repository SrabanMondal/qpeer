# INC-070: The console Undo bar said "Called #?" for a Priority Pass

| Field | Value |
|---|---|
| Date found | 2026-10-30 |
| Severity | S3 |
| Area | mobile, shared |
| Status | fixed-unverified-on-device |
| Original ID | Step 4 device check |

## Summary

After NEXT called P1, the Undo bar in the staff console showed "Called #?". The bar now takes the label of the most recently called token (same `label` as the console lists: `47`, `P1`, `T2`).

## Impact

Staff could not see which ticket the Undo would bring back. No data was wrong.

## Detection

Step 4 device check on 2026-10-30 (Samsung A9, preview APK EAS build `43cd96c6`, dev Worker): NEXT called P1 with no regular waiting, then No-show.

## Timeline

2026-10-30: found during the device check and fixed the same day (times unknown).

## Root cause

The bar printed `state.nowServing ?? "?"`. "Now serving" is the token still at a counter, else the last served one, so it is empty after a No-show (the token moves to grace) while the 30 s undo window is still open. The exact moment of the observation was not recorded; this is the path that gives "#?" for a P ticket.

## Fix

- `packages/shared/src/console.ts`: `lastCalledLabel(state)` returns the label of the most recently called token in `serving`, `grace` or `missed`.
- `apps/mobile/src/screens/queue-console.tsx`: the Undo bar uses `lastCalledLabel(state) ?? state.nowServing`, and says "Called next" instead of "#?" when neither is known.

Branch `fix/step4-device-findings`, fix commits `d9bb8df` (helper) and `fd74df9` (app); merge commit unknown.

## Verification

`packages/shared/src/console.test.ts`, "lastCalledLabel (Undo bar)": a called P1, P1 in grace after a No-show, the latest of a regular and a triage call, and nothing called. `npm run check` and `expo export` green. Not yet tried on a phone.

## Follow-ups

- On the phone: NEXT on a P ticket, then No-show within 30 s → the bar shows "Called #P1".

## Lessons

None new.
