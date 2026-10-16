# INC-043: Map card and business page disagreed on "open"

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S2 |
| Area | mobile, api |
| Status | fixed-unverified-on-device |
| Original ID | B16 |

## Summary

At 19:11 IST, the map card for "Demo · Bakshi Nagar Mobile Care" showed "Open now". Its public page showed "Closed now · Today: 9:00 AM – 6:00 PM", and the queue on the same page showed "Open" with Join enabled. The join screen showed "Open now" again. With the "Open now" filter on, this business and Demo Clinic left the list, but both showed an "Open now" badge before.

## Impact

A customer sees three answers to "is it open?" and cannot trust any of them.

## Detection

Step 3 device check on 2026-10-16, with the demo seed.

## Timeline

Unknown.

## Root cause

Two rules exist. The map card, the join screen and the queue badge use the queue state (open or closed by staff). The page banner (`isOpenNow`) and the `openNow` filter of `GET /v1/map` use the business hours. The demo seed opens queues without regard to hours, and no job closes a queue at closing time (see INC-047). So a queue can be open outside the hours.

## Fix

Branch `feat/fix-batch-rebuild`, commits 8e17550 (shared `openLook`), 0d93a29 (`openNow` SQL) and 9627e5f (screens). The owner agreed the rule on 2026-10-16: the queue state decides if a customer can join; the hours are information. One shared function gives the words: "Open now", "Open (after usual hours)", "Paused", "Queue not open" (inside hours, no queue open) and "Closed now". The map card, list row, business page banner and queue badges, and the join screen use it. `GET /v1/map?openNow=1` now keeps businesses with a queue that is open and not paused, whatever the hours. `GET /v1/queues/:id` gives the join screen `isOpenNow` and today's hours. The auto-close (INC-047) makes a queue open long after hours rare.

## Verification

`openLook` unit tests; `map.test.ts` "MAP-04/B16" (open after hours is kept, paused and not-opened are not, the limit applies after the filter); the API test of `business.isOpenNow` on the queue info. Not yet checked on a phone.

## Follow-ups

Device check with the demo seed after 18:00 IST: card, list, page and join screen all say "Open (after usual hours)".

## Lessons

One user-visible word ("open") needs one rule in every screen and in every API filter.
