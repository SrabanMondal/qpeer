# INC-036: workers.dev TLS failure right after the first deploy

| Field | Value |
|---|---|
| Date found | unknown (between 2026-10-14 and 2026-10-16) |
| Severity | S4 |
| Area | tooling |
| Status | benign |
| Original ID | none |

## Summary

Right after the first deploy of a Worker, a request to its `workers.dev` URL failed with a TLS error. A retry a short time later worked.

## Impact

No user impact.

## Detection

The first request after the deploy failed.

## Timeline

Unknown. Which Worker it was is unknown. The exact error text is unknown.

## Root cause

Unknown. The failure was transient (it went away by itself). It happened right after the first deploy.

## Fix

None needed. Retry the request.

## Verification

The retry succeeded.

## Follow-ups

None.

## Lessons

If a new `workers.dev` URL fails with a TLS error right after the first deploy, wait a short time and retry. Look for a bug only if the retry fails.
