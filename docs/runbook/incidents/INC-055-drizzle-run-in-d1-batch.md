# INC-055: `db.run(sql…)` inside a Drizzle D1 batch failed every payment

| Field | Value |
|---|---|
| Date found | 2026-10-29 |
| Severity | S4 |
| Area | api |
| Status | fixed |
| Original ID | none |

## Summary

The first Step 4 payment code put `db.run(sql\`…\`)` statements into `db.batch([...])` to write the payment status and the ledger rows in one transaction. Every confirm and refund answered 500 (`Cannot read properties of undefined (reading 'bind')`). We changed those batches to plain D1 prepared statements (`env.DB.prepare(...).bind(...)` in `env.DB.batch`).

## Impact

No user impact: the new payments API tests found it before the code was committed.

## Detection

`test/payments.test.ts` on branch `feat/step4-backend`: 14 of 16 tests answered 500.

## Timeline

2026-10-29, during development (UTC unknown).

## Root cause

Drizzle's `db.run()` returns a result promise, not a batchable query; the D1 batch needs prepared statements or Drizzle query builders.

## Fix

`apps/api/src/modules/payments/service.ts`: `ledgerStmt` and the capture/refund batches use D1 prepared statements. Branch `feat/step4-backend`.

## Verification

All API tests pass (`npm run check`).

## Follow-ups

None.

## Lessons

In a D1 batch, use D1 prepared statements or Drizzle builders, never `db.run(sql…)`.
