# INC-043: Map card and business page disagreed on "open"

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S2 |
| Area | mobile, api |
| Status | open |
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

Not done. Proposed rule: the queue state decides if a customer can join. The hours are information. When a queue is open outside the hours, show "Open (after usual hours)". The `openNow` filter uses the same rule as the badge. The auto-close in INC-047 makes the conflict rare.

## Verification

Not yet.

## Follow-ups

Fix together with INC-047.

## Lessons

One user-visible word ("open") needs one rule in every screen and in every API filter.
