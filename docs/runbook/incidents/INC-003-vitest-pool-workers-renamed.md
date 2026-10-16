# INC-003: Cloudflare renamed `@cloudflare/vitest-pool-workers`

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S4 |
| Area | tooling |
| Status | fixed |
| Original ID | Step 0 follow-up 3 |

## Summary

The API test runner package `@cloudflare/vitest-pool-workers` was renamed to `@cloudflare/vitest-plugin`. We moved to the new package before the Step 2 backend work.

## Impact

No user impact.

## Detection

We saw the rename during Step 0. How we saw it is unknown. Commit 794ed5e recorded it in `NOTES.md`.

## Timeline

Unknown. Commit 794ed5e added the note on 2026-10-15.

## Root cause

An upstream rename by Cloudflare.

## Fix

Commit 3630452 ("chore: migrate to cloudflare vitest plugin and update biome config") changed `apps/api/package.json`, `apps/api/vitest.config.ts`, `apps/api/test/setup.ts` and `apps/api/tsconfig.json`. Merge ebe8e7a brought in branch `chore/tooling` on 2026-10-15.

## Verification

The Step 2 backend work (merge 28ad2c7) ran on the new plugin. `NOTES.md` recorded `npm run check` green with 100 API tests.

## Follow-ups

None.

## Lessons

Act on a rename or deprecation notice before the next feature task, not during it.
