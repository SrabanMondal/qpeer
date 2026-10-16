# INC-035: Filtered migration output hid a pending D1 migration

| Field | Value |
|---|---|
| Date found | unknown (between 2026-10-14 and 2026-10-16) |
| Severity | S4 |
| Area | tooling |
| Status | fixed |
| Original ID | none |

## Summary

We ran `wrangler d1 migrations apply` and filtered its output. The filter hid a pending migration. A re-run with full output and `wrangler d1 migrations list` showed the real state.

## Impact

No user impact is known. A Worker that runs on a schema with a missing migration fails on queries that use the new tables or columns.

## Detection

A re-run with full output, then `wrangler d1 migrations list`.

## Timeline

Unknown. The migration and the database are also unknown.

## Root cause

The filter on the command output removed the lines that showed the pending migration.

## Fix

A rule, no code change. Never filter the output of a migration command. After you apply migrations, run `wrangler d1 migrations list` for that database and environment, and make sure that no migration is pending.

## Verification

`wrangler d1 migrations list` showed the state after the re-run. The output is not kept.

## Follow-ups

None.

## Lessons

See "Migrations" in [lessons.md](../lessons.md).
