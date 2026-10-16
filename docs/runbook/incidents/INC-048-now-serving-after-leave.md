# INC-048: "Now serving" kept a ticket that left while called

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S2 |
| Area | queue engine |
| Status | fixed-unverified-on-device |
| Original ID | none (coordinator phone check) |

## Summary

Ticket #2 of Demo Clinic OPD (dev) was CALLED, and the customer left it. Afterwards the join screen and the new ticket #3 still showed "Now serving #2". The queue engine now recomputes "Now serving" after every change, so a called ticket that leaves, is skipped or misses its turn stops showing at once.

## Impact

Customers saw a number that was no longer at the counter, and could think the queue had stopped.

## Detection

The coordinator saw it on the phone on 2026-10-16, after the Step 3 device check.

## Timeline

Unknown.

## Root cause

`now_serving` in the QueueDO was set only by Next (to the called token) and by Undo. Leave, skip, no-show and served never changed it, so it kept the label of a token that had left.

## Fix

Branch `feat/fix-batch-rebuild`, commit 610e9e8. Rule (decided in the batch): "Now serving" is the CALLED token that was called last; when nobody is at a counter, the last token SERVED this session; nothing when the queue is closed. The DO keeps `last_served`, recomputes `now_serving` in `afterChange` after every mutation, and Undo restores `last_served`. The snapshot, the token views and the console all read this one value.

## Verification

`apps/api/test/fix-batch.test.ts` ("Now serving"): leave while CALLED → last served shows; no-show and skip with nothing served → empty; admit → shows again; the D1 snapshot follows; Undo restores. Not yet checked on a phone.

## Follow-ups

Device check: call a ticket, leave it from the customer side, look at the join screen and another ticket.

## Lessons

A value derived from state (like "now serving") must be recomputed from the state after every change, not set by only one of the actions.
