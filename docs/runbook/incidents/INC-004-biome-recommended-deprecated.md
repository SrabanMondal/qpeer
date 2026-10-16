# INC-004: Biome reported the `recommended` field as deprecated

| Field | Value |
|---|---|
| Date found | 2026-10-15 |
| Severity | S4 |
| Area | tooling |
| Status | fixed |
| Original ID | Step 0 follow-up 4 |

## Summary

Biome, the linter and formatter of this repo, reported `"recommended": true` in `biome.json` as deprecated. We changed it to `"preset": "recommended"`.

## Impact

No user impact. Lint output had a deprecation warning.

## Detection

Biome printed the warning during Step 0. Commit 794ed5e recorded it in `NOTES.md`.

## Timeline

Unknown. Commit 794ed5e added the note on 2026-10-15.

## Root cause

A configuration change in Biome 2.x.

## Fix

Commit 3630452 changed `linter.rules` in `biome.json`. Merge ebe8e7a (branch `chore/tooling`) brought it to `main` on 2026-10-15.

## Verification

Later `npm run check` runs passed. A record of the warning output after the fix is unknown.

## Follow-ups

None.

## Lessons

Same as [INC-003](INC-003-vitest-pool-workers-renamed.md).
