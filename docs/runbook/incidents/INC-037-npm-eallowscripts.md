# INC-037: `expo install` failed with EALLOWSCRIPTS under npm 12

| Field | Value |
|---|---|
| Date found | unknown (between 2026-10-14 and 2026-10-16) |
| Severity | S4 |
| Area | tooling |
| Status | fixed |
| Original ID | none |

## Summary

`npx expo install` failed under npm 12 with `EALLOWSCRIPTS`. npm 12 runs a package install script only after the project approves it. We installed with npm, then let Expo fix the versions.

## Impact

No user impact. Package installs for the mobile app failed.

## Detection

The npm error during an install for `@qpeer/mobile`.

## Timeline

Unknown. The `allowScripts` list in the root `package.json` first appears in commit 593bcf6 on 2026-10-14.

## Root cause

`expo install` calls npm, and npm 12 stopped on install scripts that were not approved.

## Fix

The workaround:

1. Run `npm install -w @qpeer/mobile`, with the package names, from the repo root.
2. Run `npx expo install --check` to fix the versions.

The `allowScripts` list in the root `package.json` approves the install scripts of `esbuild` and `workerd` and denies them for `@firebase/util` and `protobufjs`.

## Verification

The installs worked with the workaround. `npx expo install --check` reported the versions.

## Follow-ups

When a new package needs an install script, add it to `allowScripts` with an exact version.

## Lessons

See "Tooling" in [lessons.md](../lessons.md).
