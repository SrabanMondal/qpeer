# INC-018: Dev-seed API test hit the 5 s test timeout

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | tooling |
| Status | fixed |
| Original ID | none (status note in `NOTES.md`) |

## Summary

An API integration test for the dev map seed sometimes failed because it ran longer than the 5 s default timeout of vitest. We raised `testTimeout` to 20 s.

## Impact

No user impact. `npm run check` failed at random on this laptop.

## Detection

Test runs during Step 3. The exact run is unknown.

## Timeline

Unknown. Commit 3432150 added the fix on 2026-10-16.

## Root cause

The test seeds Durable Object and D1 data, and that takes more than 5 s on this laptop. A Durable Object is the Cloudflare object that runs one queue. D1 is the Cloudflare SQL database.

## Fix

Commit 3432150 ("feat: add live queue map, list view and public business page", merge cae265e) added `testTimeout: 20_000` to `apps/api/vitest.config.ts`, with a comment.

## Verification

Later `npm run check` runs passed with 118 API tests and more.

## Follow-ups

None.

## Lessons

If a slow integration test fails at random, raise its timeout. Do not retry it until it passes.
