# QPeer Build Progress Notes

## Status
<!-- updated 2026-11-15 -->
Current task: **UI redesign of the app** (owner's request, 2026-11-15), plus the Step 5 Insights phone check. State: not started; the session was compacted right before it.
Next step: load the `app-ui` skill (`C:\Users\HP\temp\.claude\skills\app-ui`, Expo/RN Android UI: Material 3, plan each screen's job first, verify on the phone) and agree the redesign scope with the owner before any code. Then a brief in `.orch/briefs/` and an Opus subagent on a branch, as usual.

**Done, merged, pushed** (GitHub private repo `https://github.com/SrabanMondal/qpeer`, `main`; push after every merge, chain with `&&` so a failed check stops the push — INC-074):
- Steps 0–3, Step 3.5 load test, fix batch (offline, storage, device hash, signed ticket, validity), Step 4 (payments, reservations, Priority Pass + upgrade, missed-turn rules, payment edge cases INC-057…066, device fixes INC-067…072), Step 5 (Insights tab: analytics owner+staff, earnings owner only; `scripts/demo` seed/simulate/reset with `DEMO_JWKS`), README.
- Tests on `main`: API 273, shared 178. Every bug and fix: `docs/runbook/` (INC-001…074, lessons in `lessons.md`). Decisions per step: architecture §23.
- APK size: `buildArchs: ["armeabi-v7a","arm64-v8a"]` in `apps/mobile/app.config.ts` → preview APK 109 MB (was 213 MB), INC-073. R8 shrinking not done (needs a full phone test).

**Step 5 cloud state (2026-11-14):** demo Worker deployed with all secrets (DEMO_JWKS, TICKET_SIGNING_KEY, RAZORPAY_*); `DEMO_JWKS` also set on dev; seeded demo: 12 businesses, 15 queues, 6 weeks (5,256 analytics rows), 932 payments. New EAS profile `demo` (extends preview, API = demo Worker).

**Phone check still to do (Step 5):** install `G:\dev\qpeer\.orch\apk\qpeer-demo.apk` (EAS `0a8ed8b6`, 110 MB; replaces the preview app), sign in with the Firebase test number on the demo server, then rerun `npm run demo:seed -- --env demo --owner-phone +91…` (Git Bash) so the account owns the demo businesses, then the Insights checklist (architecture §19.2 / Step 5 report: 7/28 days, queue chips, busy-hours strip, insight cards, Earnings + "All payments", empty state, staff view, offline "Saved … ago", light/dark, large font). The slim preview APK (`qpeer-preview-slim.apk`, EAS `00388aa6`) is also not yet tried on a phone.

**Device-verified (Samsung A9, Android 10):** Steps 0–2, B9/B10, most of Step 3, fix batch basics, Step 4 payments flow (2026-10-30) and the 25 km list (INC-072). **Not yet verified:** Step 3 script steps 2, 4, 10, 12, 15 (need phone setting changes: ask the owner); B1 offline cold start; Google link name fill; INC-069…071 (one alert per phone, Undo label, close-dialog refund line); Skip ahead, staff rejoin by check code, owner Payments screen (better in a group test).

## Environments
- `dev` Worker `https://qpeer-api-dev.qpeer-api.workers.dev`, D1 `qpeer-dev`; migrations 0000–0007. Secrets: TICKET_SIGNING_KEY, RAZORPAY_* (3), DEMO_JWKS.
- `demo` Worker `https://qpeer-api-demo.qpeer-api.workers.dev`, D1 `qpeer-demo`; migrations 0000–0007; seeded (above). Razorpay webhook NOT pointed at demo (only dev has one).
- `loadtest` Worker `https://qpeer-api-loadtest.qpeer-api.workers.dev`, D1 `qpeer-loadtest`; `LOADTEST_JWKS`.
- Free plan: max 5 cron triggers per account; each env has only `*/15` (INC-056). A 6-week demo seed ≈ 10k D1 rows written (free plan 100k/day): about one reset+seed per day.
- EAS profiles: development, preview (dev API), demo (demo API), production. APKs in `G:\dev\qpeer\.orch\apk\` (gitignored).
- Secrets live only in gitignored `secrets/` (razorpay-test.env, ticket-signing-key.json, loadtest/demo keys). Upload with `wrangler secret put … < file`; never print values.

## Plan
1. **UI redesign** (next; scope to agree with the owner) + Step 5 phone check.
2. **Step 6 extras:** Add person + claim code, verified ratings (decided 2026-10-18; HLD §6.7, RAT-01…05).
3. **Step 7: Business verification and payouts** (decided by the owner, 2026-11-14, side chat; build after Step 6): Razorpay Route linked account per business, business share transferred per paid ticket, Razorpay KYC = identity check, "Verify location" at the pin, "Report this business", admin document review for free-only businesses. Owner must enable Route on the Razorpay test account first. HLD §6.8, architecture §23, checklist VER-01…07, PAYOUT-01…05.
4. **Finish:** NFR-11 rate limits; leave-home-by; optional R8 shrinking; full demo rehearsal on `demo` with the phone.
- Later latency win: fold `checkJoin` into `allocate`.

## Decisions
- Owner agreed 2026-10-16: offline degrades, never blocks (B13); queue state decides "open", hours inform (B16); auto-close 30 min after the last hours range with Keep open (B20); device hash per walk-in (C2); signed offline ticket (C3); per-queue ticket validity with carry-over (C4). Architecture §23.
- Owner decided 2026-10-18: missed-turn rules A + R1–R4, Priority Pass + upgrade + C1–C6, ratings RT1/RT2, Skip uses the rejoin delay, R2 check code. 2026-10-30: when no regular waits, the priority head is called at once.
- Owner decided 2026-11-14: businesses created before Step 7 (dev/demo) stay unverified, no migration; the database starts clean at the real release (VER-07).
- My calls in Step 5 (owner may revisit): earnings owner-only (staff see analytics only); demo key accepted on dev too; Earnings lists money events, Payments screen stays per-payment.

## Open questions
- Step 7: unverified businesses hidden from the map, or shown with an "Unverified" label? Recommendation: hidden. Owner to confirm.
- ₹100 Priority Pass refund (dev, paid 2026-10-30 19:23) stuck `refund_due`: Razorpay test mode answers 400 `BAD_REQUEST_ERROR` "invalid request sent" to every refund on that payment (₹20 one worked). Owner can issue it from the Razorpay dashboard; since INC-067 our server adopts dashboard refunds. Cause unknown.
- Does the professor want a say on priority defaults for public hospitals / government offices? Owner decided: business-set, no platform cap, ratings as the check.
- Real fees and revenue split.
- B11 (watch, INC-016): process killed once during fast taps; not reproduced.
- B12 (INC-017): dev-build "Tools" gear overlaps the header pill (dev only).

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
