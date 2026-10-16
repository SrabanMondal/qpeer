# INC-020: PowerShell dropped the `--` in a loadtest npm script

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S4 |
| Area | tooling |
| Status | fixed |
| Original ID | none |

## Summary

In PowerShell, `npm run loadtest:baseline -- --tail-log …` failed with npm error `EUNKNOWNCONFIG`. PowerShell removed the `--`, so npm read `--tail-log` as its own option. We now run the loadtest npm scripts from Git Bash.

## Impact

No user impact. The run did not start.

## Detection

The npm error during Step 3.5. Which run it was is unknown.

## Timeline

Unknown time on 2026-10-16.

## Root cause

Windows PowerShell 5.1 handles `--` itself when it calls `npm`. The `--` did not reach npm.

## Fix

A rule, no code change. Run `npm run loadtest:*` from Git Bash. The status entry in `NOTES.md` has this rule.

## Verification

The later runs from Git Bash took `--tail-log`. For example, `.orch/full-r3.out` shows `--tail-log .orch/tail-r3.log` passed to `run.ts`.

## Follow-ups

None.

## Lessons

See "Load-test operation" in [lessons.md](../lessons.md).
