<!-- Copy this file to incidents/INC-NNN-short-slug.md. The links below work from that folder. -->

# INC-NNN: Short title

| Field | Value |
|---|---|
| Date found | YYYY-MM-DD, or unknown |
| Severity | S1, S2, S3 or S4 (see [README](../README.md#severity-scale)) |
| Area | mobile, api, queue engine, loadtest harness, tooling or process |
| Status | fixed, fixed-unverified-on-device, open, watch or benign |
| Original ID | The ID in `NOTES.md` (for example B1, F3, G1), or none |

## Summary

Two or three sentences. Say what went wrong and what we changed.

## Impact

Say who saw the problem and what they saw. If no user saw it, write that.

## Detection

Say how we found it and when. Name the device check, the test, or the load-test report.

## Timeline

List the known times in UTC or IST. Write the zone. If the times are not known, write "unknown".

## Root cause

State the cause that we found. If we did not find the cause, write "unknown".

## Fix

Say what changed. Give the branch, the fix commit hashes and the merge commit hash.

## Verification

Say how we made sure that the fix works: unit tests, a device check, or a load-test run with its report.

## Follow-ups

List the work that is still open. If there is none, write "None".

## Lessons

Give the rule that we keep from this incident. Add the rule to [lessons.md](../lessons.md) too.
