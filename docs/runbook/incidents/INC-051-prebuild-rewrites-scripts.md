# INC-051: `expo prebuild` rewrote the app's npm scripts

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | tooling |
| Status | fixed |
| Original ID | none (fix batch) |

## Summary

A local `npx expo prebuild --platform android --clean`, run only to inspect the native project, changed `apps/mobile/package.json`: `"android": "expo start --android"` became `"expo run:android"` (and the same for iOS). The change was reverted before the commit.

## Impact

None. If committed, `npm run android` would start a local native build instead of Metro.

## Detection

`git diff` after the prebuild in the fix batch.

## Timeline

Unknown.

## Root cause

`expo prebuild` updates the `android`/`ios` scripts for projects that now have native folders. The `android/` folder is gitignored here (EAS builds in the cloud), so the change is unwanted.

## Fix

Reverted the two script lines; deleted the generated `android/` folder.

## Verification

`git diff apps/mobile/package.json` shows only the new dependencies.

## Follow-ups

None.

## Lessons

After a local `expo prebuild`, check `git diff apps/mobile/package.json` and revert the script changes; delete `android/`.
