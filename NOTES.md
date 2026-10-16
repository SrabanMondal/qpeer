# QPeer Build Progress Notes

## Status
<!-- updated 2026-10-16 -->
Current task: Step 3 device check done; fix batch for B13–B20 proposed, waiting on the owner's answer to two rules (below). State: between steps.
Next step: when the owner confirms the B16/B20 rules, write `.orch/briefs/fix-b13-b20.md` and run one Opus subagent; in parallel the owner creates the Razorpay test account for Step 4.

**Done and merged on `main`:** Step 0 foundations · Step 1 business (profile, pin, hours, queues, QR) · Step 2 live queue (QueueDO engine, walk-in GPS join, console, ticket, live WebSocket, push alerts) · Step 1/2 fix passes · Step 3 map (`/v1/map`, public stats, list view, public business page, dev seed) · Step 3.5 load test (3 fix rounds, final runs green) · runbook incident log.
- Per-step build detail lives in git history and `docs/QPeer_v1_Backend_Architecture.md` (§23 holds the decisions per step). Every bug and its fix lives in `docs/runbook/` (INC-001 to INC-047; standing rules in `docs/runbook/lessons.md`). Record new incidents there, not here.
- Tests: API 154, shared 104 (`npm run check`).

**Device-verified on the Samsung A9 (Android 10):** Steps 0–2 (QR join, alerts background + cold start, leave, offline/reconnect), B9 clock popup and B10 console layout (2026-10-16), Step 3 map script steps 1, 3 (partial), 5–9, 13, 14 (2026-10-16).
**Not yet verified on a phone:** Step 3 script steps 2, 4, 10, 12, 15 (denied-permission path, zoom-out hint, offline, light theme, large font: these need phone setting changes, ask the owner first); B1 offline cold start; Google link name fill; H1 app-side `rev` merge; B5 "turn on location" path.

## Environments
- `dev` Worker `https://qpeer-api-dev.qpeer-api.workers.dev`, D1 `qpeer-dev` (`a9adedc6-…`). Redeployed 2026-10-16 with all Step 3.5 fixes. Migrations 0000–0004 applied.
- `demo` D1 `qpeer-demo` (`59f9618a-…`) migrated to 0004; demo Worker not deployed yet (Step 5).
- `loadtest` Worker `https://qpeer-api-loadtest.qpeer-api.workers.dev`, D1 `qpeer-loadtest` (`12cf4f5a-…0579`), secret `LOADTEST_JWKS` set; private key in gitignored `secrets/loadtest-key.json`. Kept up for reruns.
- EAS project `e7efb464-…` (account `sraban`); dev build installed on the phone. JS-only changes need only a Metro reload.

## Plan
1. **Fix batch B13–B20** (runbook INC-040 to INC-047) + remove the `"lint": "expo lint"` script in `apps/mobile/package.json` and the `npx expo lint` line in `apps/mobile/AGENTS.md` (INC-019 trap). Optional in the same batch: B15 device hash (INC-042).
2. **Step 4 payments** (Razorpay test mode). Owner must first create a Razorpay test account (key id, key secret, webhook secret; no KYC). Reservations, Priority Pass setting, verify + webhook, refunds, forfeits, ledger, payment history, reconciliation cron. `react-native-razorpay` is in the dev build (check whether it needs a config plugin → possible rebuild). Design the business-set reservation validity (owner's idea, 2026-10-16) here.
3. **Step 5 insights + demo data:** analytics + earnings screens, Jammu seed with 4–8 weeks of history, live demo simulator, deploy the `demo` Worker, reset command.
4. **Step 6 extras** (if time): Add person + claim code, Priority Pass on console, verified reviews.
5. **Finish:** one native rebuild batching QR-as-image share/save (view-shot + sharing/media-library), a storage module (persist last ticket view for offline cold start, battery-tip dismissal, console queue choice, map filters), and the server-signed offline ticket (INC-042 follow-up); NFR-11 rate limits; leave-home-by; full demo rehearsal on `demo` with the phone.
- Later latency win: fold `checkJoin` into `allocate` (one less Worker↔DO round trip per join).

## Decisions
- Offline: degrade, do not block. One slim offline banner, ticket keeps last view with "Last updated", map shows a calm card, server actions disabled with a reason, console greyed "Offline — actions paused". (Claude proposed 2026-10-16; owner had asked "overlay or degrade?" and has not objected.) [owner confirmation pending]
- Walk-in tickets stay tied to the day's queue session; business-set validity (hours to days) applies to Step 4 reservations. (Claude proposed 2026-10-16) [owner confirmation pending]
- Anti-abuse for anonymous users: hash of `ANDROID_ID` per walk-in ticket + strikes per device hash (INC-042). (Claude proposed 2026-10-16) [owner confirmation pending]
- Proposed, asked the owner 2026-10-16, no answer yet: **B20** auto-close each queue 30 min after its last hours range, with a console warning so late staff can keep it open; **B16** queue state decides if a customer can join, hours are information, "Open (after usual hours)" label, `openNow` filter uses the same rule.

## Open questions
- Priority Pass rules ("VIP pay to skip" vs capped): owner + professor.
- Real fees and revenue split.
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
