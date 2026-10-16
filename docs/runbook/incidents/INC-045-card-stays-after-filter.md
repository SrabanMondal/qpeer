# INC-045: The map card stayed open after a filter hid its business

| Field | Value |
|---|---|
| Date found | 2026-10-16 |
| Severity | S3 |
| Area | mobile |
| Status | open |
| Original ID | B18 |

## Summary

The card for "Demo · Bakshi Nagar Mobile Care" (a service centre) was open on the map. The tester tapped the "Lab" filter. The pill left the map, but the card stayed open.

## Impact

The card shows a business that the active filter excludes.

## Detection

Step 3 device check on 2026-10-16.

## Timeline

Unknown.

## Root cause

The selected business in `screens/discover/` is not cleared when the filtered data no longer contains it.

## Fix

Not done. Close the card when the selected business is not in the current results.

## Verification

Not yet.

## Follow-ups

None.

## Lessons

None yet.
