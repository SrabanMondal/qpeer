# QPeer Build Progress Notes

## Status
<!-- updated 2026-10-16 -->
Current task: fix batch + native rebuild on branch `feat/fix-batch-rebuild` (B13–B20 = INC-040…047, INC-048/049 from the phone, C1 storage, C2 device hash, C3 signed ticket, C4 ticket validity + carry-over). Code done, `npm run check` green; not merged, not deployed, not on a phone.
Next step: review + merge; D1 migration 0005 on `dev` (then `demo`/`loadtest`), `TICKET_SIGNING_KEY` secret, deploy `dev`, `--app` public key commit, one `eas build --profile development`, then the device checklist in the branch report. Then Step 4 (owner creates the Razorpay test account).

**Done and merged on `main`:** Step 0 foundations · Step 1 business (profile, pin, hours, queues, QR) · Step 2 live queue (QueueDO engine, walk-in GPS join, console, ticket, live WebSocket, push alerts) · Step 1/2 fix passes · Step 3 map (`/v1/map`, public stats, list view, public business page, dev seed) · Step 3.5 load test (3 fix rounds, final runs green) · runbook incident log.
- Per-step build detail lives in git history and `docs/QPeer_v1_Backend_Architecture.md` (§23 holds the decisions per step). Every bug and its fix lives in `docs/runbook/` (INC-001 to INC-047; standing rules in `docs/runbook/lessons.md`). Record new incidents there, not here.
- Tests: API 154, shared 104 (`npm run check`) on `main`; the fix-batch branch has API 178, shared 135.

**Device-verified on the Samsung A9 (Android 10):** Steps 0–2 (QR join, alerts background + cold start, leave, offline/reconnect), B9 clock popup and B10 console layout (2026-10-16), Step 3 map script steps 1, 3 (partial), 5–9, 13, 14 (2026-10-16). Full customer journey from the map (2026-10-16, before the fix batch): map → card → View details → Join → GPS check → ticket #3; owner then paused (push `queue_paused` sent 19:36:33 IST), NEXT (push `called` 19:36:52), Served (#3 `SERVED` 19:37:00), ticket showed served (owner-tested).
**Fix batch merged 2026-10-16 (`38e8c15`):** migration 0005 applied to dev/loadtest/demo, `TICKET_SIGNING_KEY` set on dev (kid `ticket-4b2a73ff`), dev + loadtest deployed, baseline load test green on the new code (395 requests). EAS builds started: development `720a5c7d-…`, preview APK `35f3efbb-…` (preview env now has `EXPO_PUBLIC_MAPBOX_TOKEN`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `GOOGLE_SERVICES_JSON`). On-device checklist for the new build: runbook INC-040…049 follow-ups.
**Step 4 device check (2026-10-30, A9, preview APK EAS `43cd96c6`, dev Worker):** passed — priority lane settings, business page chip + Reserve + Buy Priority Pass, honest "not much faster" preview, rules before paying, ₹100 pass via test netbanking (ledger 10000 / 7000 / 3000), BOOKED + check code, check-in (B5 location-off card, then P1 in priority lane), NEXT with no regular waiting, No-show → grace push + countdown → MISSED + push, GPS rejoin, ₹20 reservation fail-then-succeed on one order (one ticket, one ledger set), manual close refund ₹20 + push, My payments states. Open: the ₹100 pass refund after close is `refund_due` because Razorpay test mode answers 400 `BAD_REQUEST_ERROR` to every refund on that payment (cause unknown; owner may check the dashboard; our retries and `refund_stuck` worked). Fixes on `fix/step4-device-findings`: INC-067…072.
**Not yet verified on a phone:** Step 3 script steps 2, 4, 10, 12, 15 (denied-permission path, zoom-out hint, offline, light theme, large font: these need phone setting changes, ask the owner first); B1 offline cold start; Google link name fill; H1 app-side `rev` merge; B5 "turn on location" path.

**Step 5 (2026-11-14, branch `feat/step5-insights`, not merged):** `GET /v1/businesses/:id/analytics` (owner+staff) and `/earnings` (owner), Insights tab (KPIs, insights, trend charts, busy-hours strip, earnings, offline last view), `scripts/demo` seed/simulate/reset with `DEMO_JWKS` demo-key auth (demo/dev/local only, `demo:` uids). `npm run check` green (API 273, shared 178 tests). Cloud steps (demo key, secrets, migrations, deploy demo, seed) and the on-device Insights check are open. Design: architecture §19.2 and §23 "Decided in Step 5".
- Demo tools: `npm run demo:gen-key` once (writes `secrets/demo-key.json`), then from Git Bash `npm run demo:seed -- --env demo --owner-phone +91…`, `npm run demo:simulate -- --env demo --queues 3 --minutes 20`, `npm run demo:reset -- --env demo [--wipe-all]`. `--help` on each.

## Environments
- `dev` Worker `https://qpeer-api-dev.qpeer-api.workers.dev`, D1 `qpeer-dev` (`a9adedc6-…`). Redeployed 2026-10-16 with all Step 3.5 fixes. Migrations 0000–0004 applied.
- `demo` D1 `qpeer-demo` (`59f9618a-…`) migrated to 0004; demo Worker not deployed yet (Step 5).
- `loadtest` Worker `https://qpeer-api-loadtest.qpeer-api.workers.dev`, D1 `qpeer-loadtest` (`12cf4f5a-…0579`), secret `LOADTEST_JWKS` set; private key in gitignored `secrets/loadtest-key.json`. Kept up for reruns.
- EAS project `e7efb464-…` (account `sraban`); dev build installed on the phone. JS-only changes need only a Metro reload.

## Plan
1. **Fix batch + rebuild** (`feat/fix-batch-rebuild`): merge, migrate, secret, deploy, rebuild, device check (see Status). Design in architecture doc §9.1, §23 "Decided in the fix batch".
2. **Step 4 payments** (Razorpay test mode). Scope: payments + remote reservations + Priority Pass + upgrade + missed-turn rules. Also: refunds for paid tokens ended by auto-close (TODO in `queue-do.ts`). Owner must first create a Razorpay test account (key id, key secret, webhook secret; no KYC). Reservations, verify + webhook, refunds, forfeits, ledger, payment history, reconciliation cron. `react-native-razorpay` is in the dev build (check whether it needs a config plugin → possible rebuild). Design the business-set reservation validity (owner's idea, 2026-10-16) here.
   - **A. Missed turn (decided 2026-10-18):** engine state MISSED (GRACE end → MISSED, not EXPIRED), `POST /v1/tokens/:id/rejoin` with the walk-in GPS check, once per ticket, placed by `rejoinDelayMin` ÷ service time within `lateWindowMin`, else the end (R1), second miss → EXPIRED + strike (free walk-ins only, C5), no carry-over (R4), fee kept/refund rules, `missed` alert + big grace countdown (R3), check code + staff "Rejoin for customer" (R2), Skip uses the same K (QUE-06). Checklist QUE-06, QUE-22…29, TOK-09, ALR-08. Rules: HLD §5.2, architecture §9.3 + §23.
   - **B. Priority Pass + upgrade (decided 2026-10-18):** BOOKED state, GPS check-in, priority lane by check-in time (P series), "Skip ahead" upgrade, Next credit rule (1 in N, C1), estimate ranges (C3) + load-test people-ahead invariant, refunds (C6), device hash on purchases. Checklist PRI-01…12; HLD §5.2, architecture §9.3/§9.4/§10.5/§23.
3. **Step 5 insights + demo data:** analytics + earnings screens, Jammu seed with 4–8 weeks of history, live demo simulator, deploy the `demo` Worker, reset command.
4. **Step 6 extras** (if time): Add person + claim code, verified ratings (decided 2026-10-18; HLD §6.7, RAT-01…05).
5. **Step 7: Business verification and payouts** (decided by the owner, 2026-11-14 (side chat); build after Step 6). Razorpay Route linked account per business; the business share is transferred on each paid ticket (test mode). Razorpay KYC counts as identity check; Qpeer adds "Verify location" at the pin, "Report this business" and an admin document review for free-only businesses. Unverified businesses take no payments. The owner must enable Route on the Razorpay test account first. Design: HLD §6.8, architecture §23 "Decided 2026-11-14", checklist VER-01…, PAYOUT-01….
6. **Finish:** NFR-11 rate limits; leave-home-by; full demo rehearsal on `demo` with the phone. (QR image, storage and signed ticket moved into the fix batch.)
- Later latency win: fold `checkJoin` into `allocate` (one less Worker↔DO round trip per join).

## Decisions
- Owner agreed 2026-10-16: offline degrades, never blocks (B13); queue state decides "open", hours inform (B16); auto-close 30 min after the last hours range with a Keep open warning (B20); device hash per walk-in (C2); signed offline ticket (C3); ticket validity set per queue, still-valid tickets carry over to the front of the next session (C4, owner's request). Details: architecture doc §23 "Decided in the fix batch".
- Owner decided 2026-10-18: R1, R2, R3, R4, RT1, RT2 all decided. Skip uses the same rejoin delay K (own class range, G1 stays) instead of "behind 3". R2: 4-character check code per ticket ("#14 · K7P2") + staff "Rejoin for customer" after MISSED. Details: architecture §9.4 + §23.
- Decided in the batch (owner may revisit): opened outside hours → auto-close at 23:59 IST; carried tickets keep their number and session (no reissue); "Now serving" = last called still at a counter, else last served.

## Open questions
- Does the professor want a say on defaults for public hospitals / government offices? Owner decided: business-set, no platform cap, ratings as the check.
- Real fees and revenue split.
- Step 7: unverified businesses hidden from the map, or shown with an "Unverified" label? Recommendation: hidden. Owner to confirm.
- B11 (watch, INC-016): process killed once during fast taps; not reproduced.
- B12 (INC-017): dev-build "Tools" gear overlaps the header pill and the map's Scan QR button (dev only).

## Working rules
- Real work → Opus subagents with a brief in `.orch/briefs/`, one branch per task; I review, run `npm run check`, merge `--no-ff`. agy/opencode only for mechanical tasks. Subagents can leave the checkout on their branch: run `git checkout main` before merging.
- Commits: one line `<type>: <message>`, no body, no trailer, no engine names (`COMMIT_GUIDELINES.md`, gitignored).
- Never change phone settings without the owner's OK (approved: toggling airplane mode). Never `am force-stop` when testing alerts (use `am kill`). Screenshot before every tap.

## Phone testing how-to
- Connect: `adb devices` (if none, ask the owner to replug, unlock, allow USB debugging). Metro: `CI=1 npx expo start --port 8081` in `apps/mobile` (background), `adb reverse tcp:8081 tcp:8081`, then `adb shell am start -a android.intent.action.VIEW -d "exp+qpeer://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" com.qpeer.app`. Wait until Metro answers `packager-status:running` before opening, else the dev client shows "unexpected end of stream".
- Screenshots: `adb exec-out screencap -p > file.png` from **Git Bash** (PowerShell corrupts the binary). Screen is 1080×2220; the image viewer shows it at 973×2000, so multiply coordinates by 1.11.
- Tab bar (y≈2060): Customer = Home 179 / Queue 540 / Profile 899; Business = Queue 136 / Business 405 / Insights 674 / Profile 945. Mode toggle in Profile at (154, 468). Pushed screens have no tab bar.
- Check server state with `npx wrangler d1 execute DB --env dev --remote --json --command "<SQL>"` in `apps/api`.

### QR join with one phone (owner's instruction, 2026-10-15)
1. Business mode → queue → **Show QR code** → screenshot to `.orch/qr/<queue>.png` → open full-screen on the laptop.
2. Phone location on, business pin within the join radius (Set pin → **Use my location**, or raise the radius).
3. Switch to Customer mode. **Ask the owner** to scan the laptop QR (in-app scanner, and the camera app for the `qpeer://q/…` deep link).
4. Drive the console (NEXT, UNDO within 30 s, No-show → grace → Admit, Served, Pause/Resume, Close) in Business mode or through the API; after each action switch to Customer → Queue tab → ticket. Joining again opens the existing ticket.

### Step 3 map script (one phone, signed-in test number, Customer mode)
1. Profile → Developer → **Add demo businesses** → toast "8 businesses, 11 queues".
2. Without location permission (revoke needs owner OK): Home opens on Jammu, no prompt, pills within ~1 s.
3. Pinch out ~zoom 10 → clusters with counts; tap one → zooms in.
4. Zoom out past 1.5° → "Zoom in to see queues across this whole area."
5. Tap a pill → blue pill + card (hours, waiting, range); Directions opens maps; tap empty map closes.
6. View details → banner, queues + Join, stats card, Reserve disabled; Join → "within 150 m".
7. Category chip, Open now, empty state + Clear filters.
8. List → sort chips (Distance only when the position is known); row → business page.
9. Recenter ◎ → permission prompt → blue dot, "near you"; Distance sort appears.
10. Denied / location off → toasts; map still pans.
11. Live refresh: console NEXT → pill/card change within ~30 s; no `/v1/map` calls off the Home tab.
12. Offline → banner, pills stay; back online → refresh.
13. Owner **Show public stats** on/off; **View public page**.
14. **Remove demo businesses** → toast "8 removed".
15. Light + dark theme, max font size.

## Load test how-to (Step 3.5)
- Run from **Git Bash** in `G:\dev\qpeer` (PowerShell eats `--`): `npm run loadtest:baseline` (50 customers, 2 min, ~400 requests) or `npm run loadtest:full` (300 customers, 5 min, ~1,600 requests). Both reset first, write `scripts/loadtest/reports/<timestamp>-<preset>.md/.json` and append a result line to the list below. Exit 0 = green, 1 = red, 2 = config error.
- Runs over 10 minutes must go in the background, one at a time (a timed-out foreground run kept going and collided with the next run's reset, INC-034 area).
- Optional coordinate scan: in another Git Bash, `npx wrangler tail --env loadtest --format json > ../../.orch/tail.log` from `apps/api`, then add `-- --tail-log .orch/tail.log`. Stop the tail by PID afterwards (TaskStop leaves node children holding the file).
- Key setup, local runs and flags: `node scripts/loadtest/run.ts --help`, architecture doc §19.1.

### Load test results
- 2026-10-16T07:58Z `baseline` 50 customers / 120 s: **green**, 395 requests, join p95 2474 ms, next p95 1904 ms — [report](scripts/loadtest/reports/2026-10-16T07-58-32-368Z-baseline.md)
- 2026-10-16T08:03Z `full` 300 customers / 300 s: **green**, 1576 requests, join p95 2654 ms, next p95 2247 ms — [report](scripts/loadtest/reports/2026-10-16T08-03-01-316Z-full.md)
- Earlier red runs and their fixes: runbook INC-020 to INC-034.
- 2026-10-16T14:47Z `baseline` 50 customers / 120 s: **green**, 395 requests, join p95 2483 ms, next p95 1899 ms — [report](scripts/loadtest/reports/2026-10-16T14-47-56-863Z-baseline.md)
- 2026-10-29T17:54Z `baseline` 50 customers / 120 s: **green**, 497 requests, join p95 1099 ms, next p95 695 ms — [report](scripts/loadtest/reports/2026-10-29T17-54-23-486Z-baseline.md)
- 2026-10-29T18:48Z `baseline` 50 customers / 120 s: **RED**, 484 requests, join p95 1009 ms, next p95 724 ms; failing: Credit counter fairness (PRI-06) — [report](scripts/loadtest/reports/2026-10-29T18-48-47-250Z-baseline.md)
- 2026-10-29T18:53Z `baseline` 50 customers / 120 s: **green**, 488 requests, join p95 901 ms, next p95 912 ms — [report](scripts/loadtest/reports/2026-10-29T18-53-25-202Z-baseline.md)
