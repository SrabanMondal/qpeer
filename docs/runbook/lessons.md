# Standing rules from incidents

Each rule comes from an incident in this runbook. The link after each rule goes to that incident.

## Testing alerts

1. Test background and cold-start alerts with a swipe-away or `adb shell am kill com.qpeer.app`. Never use `am force-stop`. A force-stopped app gets no FCM (Firebase Cloud Messaging) messages, and Android clears its notifications. ([INC-013](incidents/INC-013-force-stop-blocks-alerts.md))
2. Make sure that the server sent the alert: look for its `push_tickets` row. Then look at the phone. ([INC-013](incidents/INC-013-force-stop-blocks-alerts.md))

## Phone handling

1. Take a screenshot before every tap. Never chain `adb` taps. ([INC-039](incidents/INC-039-adb-tap-drift.md))
2. If the system kills the app with no crash in logcat, save `adb logcat -b all` and `adb shell dumpsys activity exit-info com.qpeer.app` at once. ([INC-016](incidents/INC-016-process-killed-quick-taps.md))
3. The test phone clock was about 11.5 minutes fast. The app now blocks use when the offset is more than 2 minutes. Set the phone to automatic time before a device check. ([INC-014](incidents/INC-014-phone-clock-skew.md))

## App code

1. Never compare a server time with the device clock. Use `serverNow()` for every countdown. ([INC-014](incidents/INC-014-phone-clock-skew.md))
2. If a client gets one object over a socket and over HTTP, keep the view with the highest server `rev`, not the last to arrive. ([INC-032](incidents/INC-032-left-to-waiting-out-of-order.md), [INC-033](incidents/INC-033-app-ticket-out-of-order-view.md))
3. A start gate must not depend on a query that can return to `pending`. ([INC-005](incidents/INC-005-offline-launch-stuck-starting.md))
4. A network call at app launch needs a retry with backoff. ([INC-001](incidents/INC-001-first-launch-sign-in-failed.md))
5. Design the offline state of every screen together: keep the last view, show its age, disable server actions with a reason. Never block a screen on the network. ([INC-040](incidents/INC-040-offline-experience-inconsistent.md))
6. Every native view that loads from the network needs an error state and a retry. ([INC-041](incidents/INC-041-raw-mapbox-error.md))
7. One user-visible word or number ("open", the wait) has one rule and one shared function on every screen and in every API filter. A cached duration carries the time it was measured. ([INC-043](incidents/INC-043-open-status-conflict.md), [INC-049](incidents/INC-049-three-different-waits.md))

## Queue engine

The queue engine runs in one Durable Object (DO) for each queue. D1 is the Cloudflare SQL database.

1. Do not make an RPC wait without a limit for a shared drain. Batch D1 writes, and send pushes and analytics in the background. ([INC-023](incidents/INC-023-serial-outbox-drain.md), [INC-030](incidents/INC-030-slow-join-after-allocation.md))
2. A skip never moves a token into the range of a higher class. Test the edge where everybody in range has a higher class. ([INC-029](incidents/INC-029-skipped-regular-in-triage-range.md))
3. A flag that schedules work must clear when no work is left. Otherwise the alarm runs in a loop. ([INC-025](incidents/INC-025-far-fanout-alarm-spin.md))
4. Recompute a value derived from state (like "now serving") after every change, not in one action only. ([INC-048](incidents/INC-048-now-serving-after-leave.md))
5. A safety job that a step defers becomes a visible bug once data lives longer than a day. Build it with the feature. ([INC-047](incidents/INC-047-queue-open-overnight.md))
6. In a D1 batch, use D1 prepared statements or Drizzle query builders, never `db.run(sql…)`. ([INC-055](incidents/INC-055-drizzle-run-in-d1-batch.md))

## Migrations

1. Never filter the output of `wrangler d1 migrations apply`. ([INC-035](incidents/INC-035-filtered-migration-output.md))
2. After you apply migrations, run `wrangler d1 migrations list` for the same database and environment. Make sure that no migration is pending. ([INC-035](incidents/INC-035-filtered-migration-output.md))

## Load-test operation

1. Run `npm run loadtest:*` from Git Bash. PowerShell drops the `--` before script flags, and npm then fails with `EUNKNOWNCONFIG`. ([INC-020](incidents/INC-020-powershell-eats-double-dash.md))
2. If a run takes longer than 10 minutes, start it in the background. Run one load test at a time. The reset of a second run wipes D1 under the first. ([INC-031](incidents/INC-031-loadtest-run-collision.md))
3. The `wrangler tail` capture is lossy under load. An event that is absent from the tail proves nothing by itself. ([INC-021](incidents/INC-021-canceled-do-alarms.md))
4. Keep client network failures apart from server errors in the checker. ([INC-022](incidents/INC-022-client-connect-timeouts.md), [INC-034](incidents/INC-034-client-network-failures.md))
5. Before you report a mismatch between live state and an audit, re-audit. ([INC-024](incidents/INC-024-socket-expired-checker-race.md))
6. If one invariant check has an exemption, apply it to the related checks too. An invariant is a rule that must hold at all times. ([INC-028](incidents/INC-028-triage-order-checker-rule.md))
7. When a checker finding is harmless, still read the whole log of that queue. A real bug was next to it. ([INC-025](incidents/INC-025-far-fanout-alarm-spin.md), [INC-029](incidents/INC-029-skipped-regular-in-triage-range.md))

## Payments

1. A client signature is never money. Ask Razorpay for the payment's status; only `captured` counts. ([INC-057](incidents/INC-057-ticket-for-uncaptured-payment.md))
2. One order can have many payments. Refund every captured payment that did not buy anything, and every guard on money must decide ticket or refund, never just log. ([INC-058](incidents/INC-058-second-payment-on-order-kept.md), [INC-060](incidents/INC-060-amount-mismatch-money-kept.md))
3. Every money path needs a recovery within minutes that does not depend on the app or one webhook, and before you offer a payment again, ask the provider whether the last one went through. ([INC-059](incidents/INC-059-lost-webhook-waits-a-day.md), [INC-061](incidents/INC-061-pay-again-when-already-paid.md))
4. In D1 SQL, cast money arithmetic on a bound JavaScript number to `INTEGER`. ([INC-062](incidents/INC-062-fractional-partial-refund.md))
5. Claim a payment in the database (a lease) before a provider call that two paths can make; count failures, back off, and alert. ([INC-063](incidents/INC-063-failed-refund-never-retried.md))

## Tooling

1. Biome is the linter. Never run `npx expo lint`. It tries to add eslint to `package.json`. ([INC-019](incidents/INC-019-expo-lint-added-eslint.md))
2. If you stop a background task that ran Metro, `wrangler tail` or `wrangler dev`, its `node` and `workerd` processes can keep running. Check the port, read the command line of each process, then stop it by exact PID. ([INC-027](incidents/INC-027-wrangler-tail-file-lock.md), [INC-038](incidents/INC-038-metro-kept-running.md), [INC-054](incidents/INC-054-wrangler-dev-kept-running.md))
3. If `npx expo install` fails with `EALLOWSCRIPTS`, run `npm install -w @qpeer/mobile <packages>`, then `npx expo install --check`. Approve install scripts in `allowScripts` in the root `package.json`. ([INC-037](incidents/INC-037-npm-eallowscripts.md))
4. If a new `workers.dev` URL fails with a TLS error right after the first deploy, retry after a short wait. ([INC-036](incidents/INC-036-workers-dev-tls-after-deploy.md))
5. If a slow DO and D1 integration test fails at random, raise its timeout. The API `testTimeout` is 20 s. ([INC-018](incidents/INC-018-flaky-dev-seed-test-timeout.md))
6. Act on a rename or deprecation notice before the next feature task. ([INC-003](incidents/INC-003-vitest-pool-workers-renamed.md), [INC-004](incidents/INC-004-biome-recommended-deprecated.md))
7. Link to a route added in the same change with a string `Href`: typed routes (`.expo/types`) are written only by `expo start`. A fresh worktree needs `apps/mobile/expo-env.d.ts` and `.expo/types` before `npm run check`. ([INC-050](incidents/INC-050-stale-typed-routes.md))
8. After a local `expo prebuild`, revert its `android`/`ios` script changes in `apps/mobile/package.json` and delete `android/`. ([INC-051](incidents/INC-051-prebuild-rewrites-scripts.md))
