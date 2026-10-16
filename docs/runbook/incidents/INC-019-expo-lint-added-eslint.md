# INC-019: `npx expo lint` tried to add eslint

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | process |
| Status | fixed |
| Original ID | none (Step 3 mobile "Deferred" note) |

## Summary

A subagent ran `npx expo lint` during the Step 3 mobile work. The command tried to add eslint to `package.json`. We reverted the change, and the dependency diff was empty after the revert. Biome is the linter of this repo.

## Impact

No user impact. The change did not reach `main`.

## Detection

The orchestrator found the change before the merge. How it found the change is unknown.

## Timeline

Unknown. Commit 3432150 added the note on 2026-10-16.

## Root cause

`apps/mobile/AGENTS.md` lists `npx expo lint` as the lint command, and `apps/mobile/package.json` has `"lint": "expo lint"`. Both come from the Expo template. The repo has no eslint setup, so `expo lint` offers to install it.

## Fix

The orchestrator reverted the change and made sure that the dependency diff was empty. `NOTES.md` (Step 3 mobile, Deferred) records that `npx expo lint` is not set up and that Biome covers lint.

## Verification

The dependency diff was empty before the merge.

## Follow-ups

Remove `npx expo lint` from `apps/mobile/AGENTS.md` and the `lint` script from `apps/mobile/package.json`, or point both to Biome.

## Lessons

Biome is the linter. Never run `expo lint`.
