# INC-033: Ticket screen kept the last view to arrive, not the newest

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S2 |
| Area | mobile |
| Status | fixed-unverified-on-device |
| Original ID | none (found with H1) |

## Summary

The investigation of [INC-032](INC-032-left-to-waiting-out-of-order.md) showed the same gap in the app. The ticket screen wrote every socket message into the cache. A refetch that started before a leave was able to land after it. The app now keeps the view with the highest `rev`.

## Impact

If the messages arrived out of order, a customer who left a queue saw the ticket as WAITING again until the next update. No report from a real user exists, because the app is not released.

## Detection

Code reading during the round-3 investigation on 2026-10-16.

## Timeline

Unknown.

## Root cause

The app trusted the last view to arrive, not the newest view. Socket and HTTP are separate connections, so their order is not fixed.

## Fix

Commit bc04350 ("fix: version token views so late updates never move a ticket back") on branch `fix/step3_5-round3`, merged in 9e120b4. `apps/mobile/src/lib/api/tokens.ts` and `apps/mobile/src/app/token/[id].tsx` keep the highest rev for socket messages, `storeToken`, leave and join answers and refetches (`mergeToken`, the `useToken` query function). Old builds ignore the new field.

## Verification

The shared `newerTokenView` unit tests and the DO tests of INC-032 cover the rule. The app change is JS only, so a Metro reload loads it. It is not yet checked on a phone.

## Follow-ups

Reload the app on the phone. Join, then leave a queue while the console makes changes. Make sure that the ticket stays on "You left the queue".

## Lessons

Same as INC-032.
