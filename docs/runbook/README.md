# QPeer runbook: incident log

This folder is the audit trail of the problems that we found while we built QPeer, and of how we fixed each one. An incident is any problem that we found: a product bug, a load-test finding, or a tooling or process failure. Each incident has one file in `incidents/`. The standing rules that we learned are in [lessons.md](lessons.md).

The first 39 incidents come from five sources:

1. `NOTES.md`: device checks, Step 0 follow-ups, Step 3.5 findings and load-test results.
2. The git history.
3. The load-test reports in `scripts/loadtest/reports/`.
4. The run output in `.orch/` (gitignored).
5. The orchestrator's own records of tooling problems.

The architecture doc `docs/QPeer_v1_Backend_Architecture.md` describes the outbox (§9.8), live updates (§9.9), the load test (§19.1) and the open questions (§23).

## Add a new incident

1. Copy [TEMPLATE.md](TEMPLATE.md) to `incidents/INC-NNN-short-slug.md`. Use the next free number and a slug of two to five words.
2. Fill in every section. If a fact is not known, write "unknown". Do not guess dates, numbers or causes.
3. Link the fix commit and the merge commit by their short hashes.
4. Add a row to the index below.
5. If the incident gives a new standing rule, add the rule to [lessons.md](lessons.md) with a link to the incident.
6. Add a line to `NOTES.md` only if the incident changes the next steps.

## Severity scale

| Level | Meaning |
|---|---|
| S1 | Wrong or lost data. |
| S2 | Wrong behavior that a customer or business user sees. |
| S3 | Minor UX problem or slow performance. |
| S4 | Developer tooling or process only. No user sees it. |

## Status values

| Status | Meaning |
|---|---|
| fixed | We merged the fix, and a test, a device check or a load-test run proved it. A process fix is a rule in [lessons.md](lessons.md). |
| fixed-unverified-on-device | We merged and tested the fix in code, but nobody checked it on a phone yet. |
| open | No fix yet. |
| watch | Seen once and not reproduced. We wait for it to happen again. |
| benign | The finding was not a product bug, or it did no harm. The incident file gives the proof. |

## Numbering and dates

We number the incidents in the order that we found them. INC-035 to INC-039 are tooling and process incidents from 2026-10-14 to 2026-10-16 with no known exact date, so they come last. Times in load-test incidents are in UTC, as in the report file names.

## Index

| ID | Date | Title | Severity | Area | Status | Original ID | Link |
|---|---|---|---|---|---|---|---|
| INC-001 | 2026-10-15 | First launch showed "No internet connection" at sign-in | S2 | mobile | fixed | Step 0 follow-up | [file](incidents/INC-001-first-launch-sign-in-failed.md) |
| INC-002 | 2026-10-15 | Google link left the display name empty | S3 | mobile | fixed-unverified-on-device | Step 0 follow-up | [file](incidents/INC-002-google-link-empty-display-name.md) |
| INC-003 | 2026-10-15 | Cloudflare renamed `@cloudflare/vitest-pool-workers` | S4 | tooling | fixed | Step 0 follow-up | [file](incidents/INC-003-vitest-pool-workers-renamed.md) |
| INC-004 | 2026-10-15 | Biome `recommended` field deprecated | S4 | tooling | fixed | Step 0 follow-up | [file](incidents/INC-004-biome-recommended-deprecated.md) |
| INC-005 | 2026-10-15 | Offline launch stuck on "Starting…" with a token refresh loop | S2 | mobile | fixed-unverified-on-device | B1 | [file](incidents/INC-005-offline-launch-stuck-starting.md) |
| INC-006 | 2026-10-15 | Keyboard covered the Save button | S3 | mobile | fixed | B2 | [file](incidents/INC-006-keyboard-covers-save.md) |
| INC-007 | 2026-10-15 | Business header was cramped | S3 | mobile | fixed | B3 | [file](incidents/INC-007-business-header-cramped.md) |
| INC-008 | 2026-10-15 | Field errors stayed after the value became valid | S3 | mobile | fixed | B4 | [file](incidents/INC-008-field-errors-stay-visible.md) |
| INC-009 | 2026-10-15 | Location off with no "turn on location" path | S3 | mobile | fixed-unverified-on-device | B5 | [file](incidents/INC-009-location-off-no-path.md) |
| INC-010 | 2026-10-15 | Hours editor is long | S3 | mobile | open | B6 | [file](incidents/INC-010-hours-editor-long.md) |
| INC-011 | 2026-10-15 | Invalid hours save did not scroll to the bad day | S3 | mobile | fixed | B7 | [file](incidents/INC-011-invalid-hours-no-scroll.md) |
| INC-012 | 2026-10-15 | Leaving a form discarded unsaved edits | S2 | mobile | fixed | B8 | [file](incidents/INC-012-unsaved-edits-lost.md) |
| INC-013 | 2026-10-15 | `am force-stop` blocked alert delivery during tests | S4 | process | benign | Step 2 device-check note | [file](incidents/INC-013-force-stop-blocks-alerts.md) |
| INC-014 | 2026-10-15 | Fast phone clock broke countdowns | S2 | mobile | fixed | B9 | [file](incidents/INC-014-phone-clock-skew.md) |
| INC-015 | 2026-10-15 | Console Undo bar and lists below the fold | S3 | mobile | fixed | B10 | [file](incidents/INC-015-console-below-fold.md) |
| INC-016 | 2026-10-15 | App process killed after quick taps | S2 | mobile | watch | B11 | [file](incidents/INC-016-process-killed-quick-taps.md) |
| INC-017 | 2026-10-15 | Dev-build "Tools" gear overlaps the header pill | S4 | mobile | open | B12 | [file](incidents/INC-017-dev-tools-gear-overlaps-pill.md) |
| INC-018 | 2026-10-16 | Dev-seed API test hit the 5 s timeout | S4 | tooling | fixed | none | [file](incidents/INC-018-flaky-dev-seed-test-timeout.md) |
| INC-019 | 2026-10-16 | `npx expo lint` tried to add eslint | S4 | process | fixed | none | [file](incidents/INC-019-expo-lint-added-eslint.md) |
| INC-020 | 2026-10-16 | PowerShell dropped the `--` in a loadtest script | S4 | tooling | fixed | none | [file](incidents/INC-020-powershell-eats-double-dash.md) |
| INC-021 | 2026-10-16 | `canceled` DO alarms under load | S3 | queue engine | benign | F1 | [file](incidents/INC-021-canceled-do-alarms.md) |
| INC-022 | 2026-10-16 | Client timeouts that never reached the Worker | S4 | loadtest harness | fixed | F2 | [file](incidents/INC-022-client-connect-timeouts.md) |
| INC-023 | 2026-10-16 | Serial outbox drain made bursts and close slow | S3 | queue engine | fixed | F2 | [file](incidents/INC-023-serial-outbox-drain.md) |
| INC-024 | 2026-10-16 | Socket EXPIRED against audit GRACE (checker race) | S4 | loadtest harness | benign | F3 | [file](incidents/INC-024-socket-expired-checker-race.md) |
| INC-025 | 2026-10-16 | Far fan-out flag made the alarm spin | S3 | queue engine | fixed | none (found with F3) | [file](incidents/INC-025-far-fanout-alarm-spin.md) |
| INC-026 | 2026-10-16 | Staff actor crashed on a null body | S4 | loadtest harness | fixed | F4 | [file](incidents/INC-026-staff-actor-null-body.md) |
| INC-027 | 2026-10-16 | `wrangler tail` processes kept the log locked | S4 | tooling | fixed | none | [file](incidents/INC-027-wrangler-tail-file-lock.md) |
| INC-028 | 2026-10-16 | Checker flagged a skipped triage token | S4 | loadtest harness | benign | G1 | [file](incidents/INC-028-triage-order-checker-rule.md) |
| INC-029 | 2026-10-16 | A skip put a regular token in the triage range | S2 | queue engine | fixed | none (found with G1) | [file](incidents/INC-029-skipped-regular-in-triage-range.md) |
| INC-030 | 2026-10-16 | A join took 20 s after the DO made the token | S3 | queue engine | fixed | G2 | [file](incidents/INC-030-slow-join-after-allocation.md) |
| INC-031 | 2026-10-16 | Two full load-test runs overlapped | S4 | process | benign | none (07:32Z run) | [file](incidents/INC-031-loadtest-run-collision.md) |
| INC-032 | 2026-10-16 | Load test saw LEFT go back to WAITING | S4 | loadtest harness | fixed | H1 | [file](incidents/INC-032-left-to-waiting-out-of-order.md) |
| INC-033 | 2026-10-16 | Ticket screen kept the last view, not the newest | S2 | mobile | fixed-unverified-on-device | none (found with H1) | [file](incidents/INC-033-app-ticket-out-of-order-view.md) |
| INC-034 | 2026-10-16 | Client connect failures failed the run | S4 | loadtest harness | fixed | H2 | [file](incidents/INC-034-client-network-failures.md) |
| INC-035 | unknown | Filtered migration output hid a pending migration | S4 | tooling | fixed | none | [file](incidents/INC-035-filtered-migration-output.md) |
| INC-036 | unknown | workers.dev TLS failure after the first deploy | S4 | tooling | benign | none | [file](incidents/INC-036-workers-dev-tls-after-deploy.md) |
| INC-037 | unknown | `expo install` failed with EALLOWSCRIPTS | S4 | tooling | fixed | none | [file](incidents/INC-037-npm-eallowscripts.md) |
| INC-038 | unknown | Metro kept running after its task stopped | S4 | tooling | fixed | none | [file](incidents/INC-038-metro-kept-running.md) |
| INC-039 | unknown | Chained adb taps nearly hit Deactivate | S4 | process | fixed | none | [file](incidents/INC-039-adb-tap-drift.md) |
| INC-040 | 2026-10-16 | Offline experience was inconsistent and the map had no fallback | S2 | mobile | fixed | B13 | [file](incidents/INC-040-offline-experience-inconsistent.md) |
| INC-041 | 2026-10-16 | The app did not handle a failed map load | S3 | mobile | fixed | B14 | [file](incidents/INC-041-raw-mapbox-error.md) |
| INC-042 | 2026-10-16 | A reinstall can get a second free ticket in the same queue | S3 | api | fixed-unverified-on-device | B15 | [file](incidents/INC-042-reinstall-second-free-ticket.md) |
| INC-043 | 2026-10-16 | Map card and business page disagreed on "open" | S2 | mobile, api | fixed | B16 | [file](incidents/INC-043-open-status-conflict.md) |
| INC-044 | 2026-10-16 | The "Show public stats" switch was drawn squashed | S3 | mobile | fixed-unverified-on-device | B17 | [file](incidents/INC-044-public-stats-switch-squashed.md) |
| INC-045 | 2026-10-16 | The map card stayed open after a filter hid its business | S3 | mobile | fixed-unverified-on-device | B18 | [file](incidents/INC-045-card-stays-after-filter.md) |
| INC-046 | 2026-10-16 | "0 waiting" still showed a wait time | S3 | mobile, shared | fixed | B19 | [file](incidents/INC-046-zero-waiting-shows-wait.md) |
| INC-047 | 2026-10-16 | A queue stayed open overnight with a called ticket | S2 | queue engine | fixed | B20 | [file](incidents/INC-047-queue-open-overnight.md) |
| INC-048 | 2026-10-16 | "Now serving" kept a ticket that left while called | S2 | queue engine | fixed-unverified-on-device | none | [file](incidents/INC-048-now-serving-after-leave.md) |
| INC-049 | 2026-10-16 | One queue showed three different waits at the same moment | S2 | mobile, shared | fixed-unverified-on-device | none (with B19) | [file](incidents/INC-049-three-different-waits.md) |
| INC-050 | 2026-10-16 | A new route failed the typecheck until `expo start` ran | S4 | tooling | fixed | none | [file](incidents/INC-050-stale-typed-routes.md) |
| INC-051 | 2026-10-16 | `expo prebuild` rewrote the app's npm scripts | S4 | tooling | fixed | none | [file](incidents/INC-051-prebuild-rewrites-scripts.md) |
| INC-052 | 2026-10-16 | An open ticket screen did not switch to the offline state | S3 | mobile | open | none | [file](incidents/INC-052-warm-offline-not-detected.md) |
| INC-053 | 2026-10-16 | "No wait" before joining, "~4 min" right after | S3 | mobile, shared | open | none | [file](incidents/INC-053-no-wait-then-four-minutes.md) |
| INC-054 | 2026-10-29 | `wrangler dev` kept port 8787 after its background task stopped | S4 | tooling | fixed | none | [file](incidents/INC-054-wrangler-dev-kept-running.md) |
| INC-055 | 2026-10-29 | `db.run(sql…)` inside a Drizzle D1 batch failed every payment | S4 | api | fixed | none | [file](incidents/INC-055-drizzle-run-in-d1-batch.md) |
| INC-056 | 2026-10-29 | The loadtest deploy hit the free-plan cron trigger limit | S4 | tooling | fixed | none | [file](incidents/INC-056-cron-trigger-limit.md) |
| INC-057 | 2026-10-29 | A ticket could be made for a payment that was never captured | S1 | api | fixed | G1 (payments review) | [file](incidents/INC-057-ticket-for-uncaptured-payment.md) |
| INC-058 | 2026-10-29 | A second captured payment on one order was kept | S1 | api | fixed | G2 (payments review) | [file](incidents/INC-058-second-payment-on-order-kept.md) |
| INC-059 | 2026-10-29 | A lost webhook plus no verify waited a day for recovery | S2 | api | fixed | G3 (payments review) | [file](incidents/INC-059-lost-webhook-waits-a-day.md) |
| INC-060 | 2026-10-29 | A captured payment of the wrong amount was neither used nor refunded | S1 | api | fixed | G4 (payments review) | [file](incidents/INC-060-amount-mismatch-money-kept.md) |
| INC-061 | 2026-10-29 | Order creation could send a paid purchase to Checkout again | S2 | api | fixed | G5 (payments review) | [file](incidents/INC-061-pay-again-when-already-paid.md) |
| INC-062 | 2026-10-29 | A partial refund could ask for a fraction of a paisa | S1 | queue engine, api | fixed | none | [file](incidents/INC-062-fractional-partial-refund.md) |
| INC-063 | 2026-10-29 | A failed refund was never retried, and refunds could race | S1 | api | fixed | none | [file](incidents/INC-063-failed-refund-never-retried.md) |
| INC-064 | 2026-10-30 | A busy scheduled run could pass the free-plan subrequest limit | S2 | api | fixed | none (review 2026-10-30) | [file](incidents/INC-064-cron-subrequest-limit.md) |
| INC-065 | 2026-10-30 | A user could buy a second paid reservation in the same queue | S2 | api, queue engine, mobile | fixed-unverified-on-device | none (review 2026-10-30) | [file](incidents/INC-065-second-paid-reservation.md) |
| INC-066 | 2026-10-30 | The load-test fairness check counted priority calls with no regular waiting | S4 | loadtest harness | fixed | none | [file](incidents/INC-066-fairness-check-too-strict.md) |
| INC-067 | 2026-10-30 | A refund made outside QPeer kept the payment stuck in `refund_due` | S1 | api | fixed | Step 4 device check | [file](incidents/INC-067-refund-outside-qpeer.md) |
| INC-068 | 2026-10-30 | A paid order kept the failure code of an earlier attempt | S3 | api | fixed | Step 4 device check | [file](incidents/INC-068-stale-failure-reason.md) |
| INC-069 | 2026-10-30 | Every alert arrived twice on one phone | S2 | api | fixed-unverified-on-device | Step 4 device check | [file](incidents/INC-069-duplicate-pushes-one-phone.md) |
| INC-070 | 2026-10-30 | The console Undo bar said "Called #?" for a Priority Pass | S3 | mobile, shared | fixed-unverified-on-device | Step 4 device check | [file](incidents/INC-070-undo-bar-question-mark.md) |
| INC-071 | 2026-10-30 | "Close for the day" did not say that paid tickets are refunded | S3 | mobile, shared | fixed-unverified-on-device | Step 4 device check | [file](incidents/INC-071-close-dialog-paid-tickets.md) |
| INC-072 | 2026-10-30 | The List view missed businesses outside the map's box | S2 | mobile, shared | fixed | Step 4 device check | [file](incidents/INC-072-list-misses-far-businesses.md) |

## Load-test runs

All cloud runs were on 2026-10-16 against the `loadtest` Worker. Each report is in `scripts/loadtest/reports/`.

| Run (UTC) | Preset | Result | Incidents |
|---|---|---|---|
| 06:21Z | baseline | RED | INC-021, INC-022, INC-023 |
| 06:26Z | full | RED | INC-021 to INC-026 |
| 06:56Z | baseline | RED | INC-028, INC-029 |
| 06:59Z | full | RED | INC-030 |
| 07:29Z | baseline | green | none |
| 07:32Z | full | RED | INC-031 |
| 07:39Z | full | RED | INC-032, INC-033, INC-034 |
| 07:58Z | baseline | green | none |
| 08:03Z | full | green | none |
