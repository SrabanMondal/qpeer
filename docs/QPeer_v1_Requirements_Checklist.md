# QPeer v1: Requirements Checklist

The working to-do list for v1 (the demo). Design details live in `QPeer_v1_High_Level_Design.md`; this file only lists **what must exist**. Tick an item when it works on a real phone against the `dev` backend, not just in tests.

**How to use it**
- IDs (`BIZ-04`) are stable. Reference them in briefs, branches and NOTES.md.
- Every data item is checked for its whole lifecycle: **create, view, edit, remove/disable**, plus its **empty / loading / error** states. Most forgotten features are an "edit" or an error state.
- `(x)` = extra. Only built if time allows (HLD §1).

---

## Modules and dependencies

| Module | Contents | Depends on | Build step |
|---|---|---|---|
| **M0 Platform** | Repo, tooling, API skeleton, token verification, D1, Durable Object stub, deploys | — | 0 |
| **M1 Identity** | Sign-in methods, account upgrade, profile, mode switch | M0 | 0–1 |
| **M2 Business** | Business profile, pin, hours, queues, settings, QR | M1 | 1 |
| **M3 Queue engine** | Durable Object: order, states, timers, wait estimates, live updates | M0 | 2 |
| **M4 Walk-in join** | QR scan, deep link, GPS check | M2, M3 | 2 |
| **M5 Token experience** | Token screen, live updates, my tokens | M3 | 2 |
| **M6 Alerts** | Push registration and alert delivery | M1, M3 | 2 |
| **M7 Map & discovery** | Map, markers, list, business detail, public stats | M2, M3 (snapshots) | 3 |
| **M8 Payments** | Orders, checkout, webhooks, refunds, forfeits, ledger, Priority Pass + upgrade (2026-10-18) | M1, M3 | 4 |
| **M9 Insights** | Analytics and earnings | M3 (events), M8 (ledger) | 5 |
| **M10 Demo data** | Seed (Jammu), simulator, demo reset | M2, M3, M8 schema | 5 |
| **M11 Extras (x)** | Add person, ratings (Priority Pass moved to M8 on 2026-10-18) | M3, M8 | 6 |

### What can be built in parallel

```text
M0 ──► M1 ──► M2 ─────────────┐
  │                           ├──► M4 ─┐
  └──► M3 (backend only) ─────┤        ├──► M7 ──► M10
                              ├──► M5 ─┤
                              ├──► M6  │
                              └──► M8 ─┴──► M9 ──► M11 (x)
```

- After **M0**: **M2 (business API + screens)** and **M3 (queue engine, backend only)** are independent and can run side by side.
- After **M2 + M3**: **M4, M5, M6** and the **backend half of M8** are independent of each other.
- **M7** needs the snapshot writes from M3 and businesses from M2. **M9** needs M3 events and the M8 ledger.
- Parallel engine runs need **separate working copies** (one checkout per engine, merged one at a time). Each module's shared contracts (zod schemas in `packages/shared`, D1 tables) are added **first, on `main`**, so parallel work doesn't collide on them.

---

## M0 Platform

- [x] **PLT-01** Monorepo with `npm run check` (typecheck + lint + tests) passing at the root
- [x] **PLT-02** API `/v1/health` (public) and `/v1/me` (signed in), with structured logs and a request ID on every response
- [x] **PLT-03** Firebase ID token verification: issuer, audience, RS256 only, expiry. Invalid → 401.
- [x] **PLT-04** D1 + Drizzle migrations, applied locally, in tests and on `dev` / `demo`
- [x] **PLT-05** QueueDO bound and reachable from the Worker
- [x] **PLT-06** `dev` environment deployed. `demo` environment created (deployed in M10).
- [x] **PLT-07** Secrets only in `.dev.vars` / Wrangler secrets / gitignored app env. `.example` templates committed.
- [x] **PLT-08** EAS development build installs on the phone and reaches the `dev` API
- [ ] **PLT-09** App shows a readable error with the request ID when the API fails

## M1 Identity

- [x] **IDN-01** First launch signs in anonymously with no screen shown *(add retry on first-launch network error — see NOTES.md)*
- [x] **IDN-02** Google Sign-In
- [ ] **IDN-03** Phone sign-in with Firebase test numbers (OTP screen, wrong-code error, resend) *(sign-in works; wrong-code and resend still to check)*
- [ ] **IDN-04** Upgrade anonymous → Google/phone **keeps the same user and their tokens** (account linking, not a new account)
- [ ] **IDN-05** "Credential already in use" during upgrade is handled (sign in to the existing account; anonymous tokens are moved or a clear message is shown)
- [x] **IDN-06** Profile screen: view name, email/phone and sign-in method; **edit display name**
- [ ] **IDN-07** Sign out (returns to anonymous). Sign out is blocked or warned while holding an active paid token.
- [x] **IDN-08** Mode switch Customer ↔ Business. Business mode is only offered to non-anonymous users. The chosen mode is remembered.
- [ ] **IDN-09** Session survives app restart. An expired token is refreshed silently.
- [ ] **IDN-10** Paid and business actions are rejected by the API for anonymous users (server-side, not just hidden buttons)

## M2 Business

**Profile**
- [x] **BIZ-01** Create a business: name, category (clinic, lab, service centre, salon, other), address, phone (optional)
- [ ] **BIZ-02** **Edit** every profile field later
- [x] **BIZ-03** Set the map pin by dragging the map / tapping, centred on the current location or the typed address area
- [ ] **BIZ-04** **Move the pin later** (edit location). The map snapshot follows immediately.
- [ ] **BIZ-05** Opening hours per weekday (open/closed, from–to). **Edit later.** "Closed today" is handled.
- [x] **BIZ-06** Validation: required fields, a pin is required before going live, sensible hours (from < to)
- [x] **BIZ-07** Business is hidden from the map until it has a pin and at least one queue
- [ ] **BIZ-08** **Deactivate business** (hidden from the map, queues closed; data kept). Reactivate. *(hide/reactivate works; closing open queues comes with Step 2)*
- [ ] **BIZ-09** An owner can have more than one business and switch between them in Business mode

**Queues**
- [x] **BIZ-10** Create a queue (name, e.g. "OPD", "Sample collection")
- [ ] **BIZ-11** **Rename** a queue. **Archive** a queue (only when it has no waiting tokens).
- [ ] **BIZ-12** Queue settings with defaults: join radius, walk-in quota, reservation fee, grace minutes, rejoin delay (min, default 15) and late window (min, default 15, or "no limit") (R1, 2026-10-18), cancel window, counters, max size. **Edit later**; changes apply to new tokens only.
- [ ] **BIZ-13** Open / close a queue for the day from the console. Closed queues reject joins.
- [ ] **BIZ-14** QR code per queue: show full screen, **share as an image**, save to the gallery for printing *(full screen + share link work; image share/save needs the next native build)*
- [x] **BIZ-15** Business list, empty state ("Create your first business"), and loading/error states on every business screen

**Access**
- [x] **BIZ-16** Only the owner can edit a business or its queues (enforced in the API)
- [ ] **BIZ-17 (x)** Invite staff by phone/email with a "staff" role (console only)

## M3 Queue engine (backend)

**Numbering and order**
- [ ] **QUE-01** Atomic numbers: concurrent joins never get the same number (tested with parallel requests)
- [ ] **QUE-02** Order: triage → priority (x) → regular, each by join sequence. A remote reservation gets its place when payment is confirmed. *(since 2026-10-18 priority follows the 1-in-N credit rule: PRI-06)*
- [ ] **QUE-03** People ahead = waiting tokens before mine. Correct after leaves, cancels, no-shows and skips.
- [ ] **QUE-04** One active free token per user per queue. *(Since 2026-10-30, INC-065: one active ticket per person per queue applies to paid reservations too — a reservation next to any active ticket is `already_in_queue`; the old paid cap, `paidPerUserCap`, is retired.)*

**Operations**
- [x] **QUE-05** Next (calls the next waiting token, records the interval and the counter)
- [ ] **QUE-06** Skip (decided 2026-10-18): the token goes back behind the same K as a rejoin (QUE-27), counted in its own class range, or to the end if fewer wait. K is fixed at the moment of the skip. A skipped regular/priority token never lands inside a higher class's range; a skipped triage token may go behind lower classes (G1). Replaces "behind the next 3".
- [ ] **QUE-07** Pause / Resume (paused time is excluded from the wait estimate; waiting users see "paused")
- [x] **QUE-08** No-show → grace (default 10 min) → Admit late arrival as next, or expire when the timer ends *(since 2026-10-18 the timer leads to MISSED, not EXPIRED: QUE-22)*
- [ ] **QUE-09** Close for the day: remaining tokens expire, paid ones are refunded via M8
- [ ] **QUE-10** Leave (customer) at any time. Cancel with a refund inside the cancel window (via M8).
- [x] **QUE-11** Triage insert (free, staff), with a daily cap
- [ ] **QUE-12** Undo the last Next within ~30 s (staff mis-tap)

**Missed turn and rejoin** (decided 2026-10-18, Step 4; HLD §5.2)
- [ ] **QUE-22** GRACE ends → new state MISSED (not EXPIRED). MISSED is out of the live order and not counted as waiting. Ticket text: "You missed your turn. When you're here, tap I'm here to rejoin."
- [ ] **QUE-23** "I'm here" rejoin: same GPS walk-in check as joining (location never stored; mocked rejected) → placed by QUE-27. Once per ticket. Simultaneous rejoins ordered by tap time (server receive time of a successful check).
- [ ] **QUE-24** Second miss, or no rejoin by queue close (or the business limit) → EXPIRED + one no-show strike (per user and per device hash) for free walk-ins only. Paid tickets get no strike (C5, 2026-10-18).
- [ ] **QUE-25** No repositioning by staff: a ticket moves back only when its owner rejoins
- [ ] **QUE-26** People ahead: no change for others when a called ticket becomes No-show or MISSED. On a rejoin, only people behind the insert point get +1.
- [ ] **QUE-27** Rejoin position (R1, decided 2026-10-18): within `lateWindowMin` after MISSED → behind max(1, ceil(`rejoinDelayMin` ÷ avgServiceMin)) WAITING, using the queue's EWMA service time (configured service time at cold start), or the end if fewer wait. After the window → the end of the line. "No limit" window allowed. Skip uses the same K (QUE-06).
- [ ] **QUE-28** Engine details (R4, decided 2026-10-18): MISSED tickets never carry over at close (they expire); a missed priority/triage holder rejoins within their own class; analytics count served-after-rejoin as served, each miss as a no-show, and leave away time out of wait statistics.
- [ ] **QUE-29** Check code and staff rejoin (R2, decided 2026-10-18): 4-character check code given at allocation, shown under the ticket number ("#14 · K7P2"), unambiguous alphabet (no 0/O, 1/I/L), stored on the token (DO + D1) and in the signed ticket. Staff "Rejoin for customer" after MISSED needs the number + check code (or a valid signed-QR scan). Same once-only and position rule as QUE-27. Neither known → serve as a new walk-in.

**Wait estimates**
- [ ] **QUE-13** EWMA of Next intervals with outlier capping. Cold start uses the queue's configured service time.
- [ ] **QUE-14** Range (low–high) from the variance. Never shows a single exact number. *(with the priority lane on, also PRI-08)*
- [ ] **QUE-15** Be-back-by / leave-home-by times (leave-home uses straight-line distance ÷ an assumed speed + a buffer)

**Timers, live updates, persistence**
- [ ] **QUE-16** Single-alarm scheduler covering grace expiries, snapshot flushes (≤ 30 s) and hourly analytics flushes
- [x] **QUE-17** WebSocket updates per token (now serving, people ahead, range, state). Hibernation API.
- [ ] **QUE-18** Map snapshot written to D1 on change (waiting, range, open)
- [ ] **QUE-19** Finished tokens written to `token_history`. Hourly counters written to `analytics_hourly`.
- [ ] **QUE-20** State survives a Durable Object restart (everything is in its storage)
- [ ] **QUE-21** Idempotent allocation keyed by the payment order ID

## M4 Walk-in join

- [x] **JON-01** In-app QR scanner (camera permission request, permission denied → explanation + settings link)
- [x] **JON-02** Scanning `qpeer://q/<id>` with the phone's camera opens the app on the join screen
- [x] **JON-03** Join screen shows the business, queue, people waiting and the wait range **before** joining
- [x] **JON-04** Location check: permission request, one high-accuracy reading, `accuracy` and `mocked` sent. Location is not stored.
- [ ] **JON-05** Clear errors: too far, fake location, no fix (> 1 km), queue closed/paused/full, already have a token
- [ ] **JON-06** Location permission denied → explanation, and "ask staff to add you" (x) as the fallback
- [ ] **JON-07** Free-lane strikes: 3 no-shows in 30 days → free joins blocked for a set time, with a clear message

## M5 Token experience

- [x] **TOK-01** Token screen: big number, now serving, people ahead, wait range, be-back-by / leave-home-by, state badge
- [x] **TOK-02** Live updates via WebSocket. **Reconnects automatically** after network loss or app background.
- [x] **TOK-03** Correct state on reopen (fetched fresh, even if alerts were missed)
- [ ] **TOK-04** States shown distinctly: booked (Priority Pass, with a Check in button), waiting, paused, called (counter N), grace, missed, served, expired, left, cancelled/refunded
- [ ] **TOK-05** Leave queue (confirm dialog). Cancel paid token (shows refund or no-refund before confirming).
- [x] **TOK-06** "My tokens" list: active first, then recent history. Empty state.
- [ ] **TOK-07** Directions button opens the phone's maps app at the business pin
- [ ] **TOK-08** MISSED ticket screen with an **I'm here** button (runs the location check, clear errors for too far / fake location, hidden after the one rejoin)
- [ ] **TOK-09** GRACE ticket screen (R3, decided 2026-10-18): a large, clear live countdown "Come now — m:ss left" on the server-corrected clock (the existing grace card, made prominent)

## M6 Alerts

- [x] **ALR-01** Ask notification permission at the right time (first join), with an explanation
- [ ] **ALR-02** Register the Expo push token. **Update it when it changes.** Remove it on sign-out.
- [ ] **ALR-03** Alerts: head back now, you're next, called (counter N), grace started, refund issued, queue paused/closed
- [ ] **ALR-04** No duplicate alerts (flags per token per alert type)
- [x] **ALR-05** Tapping an alert opens that token's screen
- [x] **ALR-06** Android notification channel with high importance. In-app guide to turn off battery optimisation.
- [ ] **ALR-07** Business console alerts: late arrival waiting in grace (optional sound)
- [ ] **ALR-08** Decided 2026-10-18 (R3), Step 4: one `missed` alert when a ticket becomes MISSED ("You missed your turn. Tap I'm here when you arrive.")

## M7 Map & discovery

- [ ] **MAP-01** Map centred on the user's location (with permission) or Jammu by default
- [ ] **MAP-02** Markers show live waiting count and open/closed. Clustering when zoomed out.
- [ ] **MAP-03** Data refreshes when the map moves and every ~30 s while visible
- [ ] **MAP-04** List view sorted by distance / wait / name. Category filter. "Open now" filter.
- [ ] **MAP-05** Business detail: queues with live wait, hours, address, public stats (average wait, average service time over 4 weeks), Reserve and "how to walk in" actions
- [ ] **MAP-06** Empty area / no results / offline / loading states
- [ ] **MAP-07** Recenter-on-me button. Location permission denied still shows the map.

## M8 Payments (Razorpay test mode)

> **Step 4 backend status (2026-10-29, branch `feat/step4-backend`, not yet on a phone, so not ticked):** server side built and covered by API/DO tests (named after the IDs) for PAY-01, PAY-03…PAY-15, PRI-01…PRI-12, QUE-02 (priority lane), QUE-06, QUE-22…QUE-29, ALR-08, and the server data for TOK-04 (BOOKED/MISSED states), TOK-08 (`rejoinAvailable`, `rejoinUntil`, `POST /v1/tokens/:id/rejoin`) and TOK-09 (`graceEndsAt`). PAY-02 and the TOK/PRI-07 screens are the mobile task. Razorpay calls were tested against a recording fake only; the real test-mode run is pending.

- [ ] **PAY-01** Create order: checks sign-in (non-anonymous), queue open, walk-in quota, per-user cap. Amount comes from queue settings, never from the client.
- [ ] **PAY-02** Checkout opens with the fee, refund rules and no-show rule shown first
- [ ] **PAY-03** Client callback verified by signature → token allocated
- [ ] **PAY-04** Webhook `payment.captured` verified by signature → same idempotent allocation (whichever arrives first)
- [ ] **PAY-05** Payment failed / cancelled / app killed mid-payment: no token, clear message, and a captured payment without a token is fixed by the webhook or refunded
- [ ] **PAY-06** Quota filled between order and capture → automatic refund + message
- [ ] **PAY-07** Cancel inside the window → refund via the API. Webhook `refund.processed` updates the status.
- [ ] **PAY-08** No-show expiry → forfeit recorded, with business and platform shares
- [ ] **PAY-09** Queue closed by the business → all paid waiting tokens refunded
- [ ] **PAY-10** Append-only ledger: capture, refund, forfeit, business_share, platform_share
- [ ] **PAY-11** Customer payment history (amount, status, refund status)
- [ ] **PAY-12** Daily reconciliation job flags payments without a token or tokens without a payment
- [ ] **PAY-13** Razorpay key secret and webhook secret exist only on the Worker
- [ ] **PAY-14** Missed turn (2026-10-18): the remote fee is kept only if the ticket expires and the person never arrived. Served, even after a rejoin → no refund (the fee paid for holding the place).
- [ ] **PAY-15** Business cancels or closes early → the remote fee is refunded, including for MISSED tickets

**Priority Pass and upgrade** (decided by the owner 2026-10-18, Step 4; HLD §5.2, architecture §9.3, §9.4, §10.5, §23)
- [ ] **PRI-01** Settings, all business-set, no platform limits: priority on/off (default OFF), price, ratio "1 priority per N regulars" (any whole number ≥ 1; the form prefills 1-in-2 when switched on), optional daily sales cap ("Sold out"), validity window (default today; hours to days), cancel refund % (default 50). **Edit later.**
- [ ] **PRI-02** Buy a pass: signed-in, non-anonymous only. Honest preview before paying ("Priority holders wait about X min · regular wait about Y min · you save about Z min"). Ticket created only after server-side confirmation (verify + webhook); no confirmation → no ticket. New state BOOKED (paid, not in the line).
- [ ] **PRI-03** Check-in on arrival: GPS within the join radius (walk-in check; mocked rejected; a counter-QR photo alone is not enough) → priority lane, ordered by check-in time, P-series number (P1, P2…). After check-in the window no longer applies.
- [ ] **PRI-04** Priority holders follow the same missed-turn rules (Grace → Missed → one rejoin → Expired)
- [ ] **PRI-05** Upgrade "Skip ahead for ₹X, about N min faster" on a WAITING ticket: payment moves the same ticket into the priority lane at the upgrade time, no check-in. Only WAITING tickets. Buying a pass while holding a ticket upgrades it, never a second ticket. Offer hidden when the saving is below the threshold (default 5 min; C2).
- [ ] **PRI-06** Next rule, engine-enforced (staff cannot pick a priority person): triage first; else the priority head if due; else the next regular. Credit counter: +1 per regular call (also when it ends as No-show), −N per priority call, capped at N, starts at 0 when a session opens; triage adds nothing; Undo of Next undoes the credit change (C1).
- [ ] **PRI-07** Regulars see "Priority lane on · 1 in N" on the business page, join screen and ticket
- [ ] **PRI-08** Estimates with priority: a regular's people ahead and wait are a range (low: only checked-in priority holders; high: every N-th call goes to priority; C3). Shared estimate and the load-test people-ahead invariant use the same rule.
- [ ] **PRI-09** Money: served → fee kept, split business/Qpeer (demo 70/30). Cancel before check-in → refund at the business's %. Never checked in by the end of the window → no refund. Checked in, missed, never rejoined → no refund, no strike (C5).
- [ ] **PRI-10** Full automatic refund when a checked-in holder is not served because the queue closed (also when closed while paused), or the business cancels or closes early. Checked-in holders never carry over to the next day (C6).
- [ ] **PRI-11** Anti-misuse: pass tied to the buyer's account (no transfer); 1 pass per account per queue per day; device hash recorded on purchases and upgrades, and the same phone cannot buy a second pass with another account; every call logged with its time.
- [ ] **PRI-12** Signed ticket QR carries the first name + last 4 phone digits only; the console shows the full name when online (C4)

## M9 Insights

- [ ] **INS-01** Analytics range picker (7 / 28 days)
- [ ] **INS-02** Peak hours by weekday (heat strip or bar chart)
- [ ] **INS-03** Average wait and average service time trend over days
- [ ] **INS-04** Served, no-shows and left counts; abandonment rate
- [ ] **INS-05** Wait-estimate accuracy (% of actual waits inside the shown range)
- [ ] **INS-06** 2–3 plain-language insights ("Tuesdays 10–12 are your busiest hours")
- [ ] **INS-07** Earnings: totals by day/week, list of captures, refunds and forfeits, business share vs platform share
- [ ] **INS-08** Empty states for new businesses ("Insights appear after your first day of queues")

## M10 Demo data

- [ ] **DEM-01** Seed: 8–15 businesses across Jammu (≈32.73 N, 74.86 E) in several categories, with queues and pins
- [ ] **DEM-02** 4–8 weeks of synthetic `analytics_hourly` data with weekday peaks and a slow trend
- [ ] **DEM-03** Past payments and refunds for the Earnings screen
- [ ] **DEM-04** Simulator: drives one or more queues live (joins, Next, leaves, no-shows) at a configurable pace
- [ ] **DEM-05** Reset command: wipes and re-seeds the `demo` environment
- [ ] **DEM-06** Seed and simulator refuse to run against anything except `dev` / `demo`

## M11 Extras (x)

- [ ] **EXT-01** Add person (staff) with a 6-digit claim code; claim from the app
- **EXT-02** Superseded 2026-10-18 (was: Priority Pass as a queue setting, 0 = no limit). Now PRI-01 to PRI-12 in M8, built in Step 4.
- **EXT-03** Superseded 2026-10-18 (was: verified reviews, stars + text, within 7 days). Now RAT-01 to RAT-05.
- **EXT-04 to EXT-08** Superseded 2026-10-18 (were: the PENDING "flexible pass" proposal). Replaced by the decided PRI-01 to PRI-12.

**Ratings** (decided by the owner 2026-10-18, Step 6; HLD §6.7)
- [ ] **RAT-01** Every SERVED customer can rate in the app: customer experience and service quality, 0–5 stars each. The lane (regular or priority) is stored.
- [ ] **RAT-02** Ratings show on the map, the business card and the business page
- [ ] **RAT-03** One rating per served ticket (server-side)
- [ ] **RAT-04** Decided 2026-10-18 (RT1): ratings split by lane ("Regular customers 2.1★ · Priority customers 4.8★") next to "Priority lane on · 1 in N"
- [ ] **RAT-05** Decided 2026-10-18 (RT2): show ratings only after at least 5 ratings (per lane); stars only, no text; the business cannot delete ratings but can reply publicly

---

## Non-functional checklist

**Performance**
- [ ] **NFR-01** Scan → token in ≤ 10 s on 4G
- [ ] **NFR-02** API p95 ≤ 500 ms (excluding Razorpay and Firebase)
- [ ] **NFR-03** "Next" reaches open token screens in ≤ 2 s
- [ ] **NFR-04** Map data for the visible area in ≤ 1 s

**Reliability and correctness**
- [ ] **NFR-05** Queue state survives app kill, phone restart and Durable Object restart
- [ ] **NFR-06** No duplicate tokens, charges or ledger rows under retries (tested)
- [ ] **NFR-07** Every money movement is in the ledger, and the ledger reconciles with Razorpay

**Security and privacy**
- [ ] **NFR-08** Every non-public endpoint requires a verified token. Owner/staff checks are on the server.
- [ ] **NFR-09** Webhook and payment signatures verified. Amounts are computed on the server.
- [ ] **NFR-10** Walk-in location is never stored. Logs never contain tokens, secrets or exact locations.
- [ ] **NFR-11** Rate limits on join, order and sign-in-related endpoints

**UX quality**
- [ ] **NFR-12** Every screen has loading, empty and error states. Errors show what to do next.
- [ ] **NFR-13** Destructive actions (leave, cancel, close queue, deactivate) ask for confirmation
- [ ] **NFR-14** Works offline gracefully: a banner, last known state, automatic recovery
- [ ] **NFR-15** Large, readable numbers. Respects the phone's font size. Touch targets ≥ 44 dp.
- [ ] **NFR-16** Android back button behaves correctly on every screen

**Engineering**
- [ ] **NFR-17** `npm run check` passes on `main` after every merge
- [ ] **NFR-18** Backend logic for each module has integration tests (Durable Object + D1, local)
- [ ] **NFR-19** Each module ends with a device checklist run on a real phone, recorded in NOTES.md
- [ ] **NFR-20** One development build covers Steps 0–5 (all native modules installed up front). A rebuild is only made when a native change is unavoidable.
