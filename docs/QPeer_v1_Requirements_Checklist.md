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
| **M8 Payments** | Orders, checkout, webhooks, refunds, forfeits, ledger | M1, M3 | 4 |
| **M9 Insights** | Analytics and earnings | M3 (events), M8 (ledger) | 5 |
| **M10 Demo data** | Seed (Jammu), simulator, demo reset | M2, M3, M8 schema | 5 |
| **M11 Extras (x)** | Add person, Priority Pass, reviews | M3, M8 | 6 |

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
- [ ] **IDN-06** Profile screen: view name, email/phone and sign-in method; **edit display name**
- [ ] **IDN-07** Sign out (returns to anonymous). Sign out is blocked or warned while holding an active paid token.
- [ ] **IDN-08** Mode switch Customer ↔ Business. Business mode is only offered to non-anonymous users. The chosen mode is remembered.
- [ ] **IDN-09** Session survives app restart. An expired token is refreshed silently.
- [ ] **IDN-10** Paid and business actions are rejected by the API for anonymous users (server-side, not just hidden buttons)

## M2 Business

**Profile**
- [ ] **BIZ-01** Create a business: name, category (clinic, lab, service centre, salon, other), address, phone (optional)
- [ ] **BIZ-02** **Edit** every profile field later
- [ ] **BIZ-03** Set the map pin by dragging the map / tapping, centred on the current location or the typed address area
- [ ] **BIZ-04** **Move the pin later** (edit location). The map snapshot follows immediately.
- [ ] **BIZ-05** Opening hours per weekday (open/closed, from–to). **Edit later.** "Closed today" is handled.
- [ ] **BIZ-06** Validation: required fields, a pin is required before going live, sensible hours (from < to)
- [ ] **BIZ-07** Business is hidden from the map until it has a pin and at least one queue
- [ ] **BIZ-08** **Deactivate business** (hidden from the map, queues closed; data kept). Reactivate.
- [ ] **BIZ-09** An owner can have more than one business and switch between them in Business mode

**Queues**
- [ ] **BIZ-10** Create a queue (name, e.g. "OPD", "Sample collection")
- [ ] **BIZ-11** **Rename** a queue. **Archive** a queue (only when it has no waiting tokens).
- [ ] **BIZ-12** Queue settings with defaults: join radius, walk-in quota, reservation fee, grace minutes, cancel window, counters, max size. **Edit later**; changes apply to new tokens only.
- [ ] **BIZ-13** Open / close a queue for the day from the console. Closed queues reject joins.
- [ ] **BIZ-14** QR code per queue: show full screen, **share as an image**, save to the gallery for printing
- [ ] **BIZ-15** Business list, empty state ("Create your first business"), and loading/error states on every business screen

**Access**
- [ ] **BIZ-16** Only the owner can edit a business or its queues (enforced in the API)
- [ ] **BIZ-17 (x)** Invite staff by phone/email with a "staff" role (console only)

## M3 Queue engine (backend)

**Numbering and order**
- [ ] **QUE-01** Atomic numbers: concurrent joins never get the same number (tested with parallel requests)
- [ ] **QUE-02** Order: triage → priority (x) → regular, each by join sequence. A remote reservation gets its place when payment is confirmed.
- [ ] **QUE-03** People ahead = waiting tokens before mine. Correct after leaves, cancels, no-shows and skips.
- [ ] **QUE-04** One active free token per user per queue. Paid reservations are capped per user (e.g. 2 per queue).

**Operations**
- [ ] **QUE-05** Next (calls the next waiting token, records the interval and the counter)
- [ ] **QUE-06** Skip (the token goes back behind the next N people, or to the end; pick one and document it)
- [ ] **QUE-07** Pause / Resume (paused time is excluded from the wait estimate; waiting users see "paused")
- [ ] **QUE-08** No-show → grace (default 10 min) → Admit late arrival as next, or expire when the timer ends
- [ ] **QUE-09** Close for the day: remaining tokens expire, paid ones are refunded via M8
- [ ] **QUE-10** Leave (customer) at any time. Cancel with a refund inside the cancel window (via M8).
- [ ] **QUE-11** Triage insert (free, staff), with a daily cap
- [ ] **QUE-12** Undo the last Next within ~30 s (staff mis-tap)

**Wait estimates**
- [ ] **QUE-13** EWMA of Next intervals with outlier capping. Cold start uses the queue's configured service time.
- [ ] **QUE-14** Range (low–high) from the variance. Never shows a single exact number.
- [ ] **QUE-15** Be-back-by / leave-home-by times (leave-home uses straight-line distance ÷ an assumed speed + a buffer)

**Timers, live updates, persistence**
- [ ] **QUE-16** Single-alarm scheduler covering grace expiries, snapshot flushes (≤ 30 s) and hourly analytics flushes
- [ ] **QUE-17** WebSocket updates per token (now serving, people ahead, range, state). Hibernation API.
- [ ] **QUE-18** Map snapshot written to D1 on change (waiting, range, open)
- [ ] **QUE-19** Finished tokens written to `token_history`. Hourly counters written to `analytics_hourly`.
- [ ] **QUE-20** State survives a Durable Object restart (everything is in its storage)
- [ ] **QUE-21** Idempotent allocation keyed by the payment order ID

## M4 Walk-in join

- [ ] **JON-01** In-app QR scanner (camera permission request, permission denied → explanation + settings link)
- [ ] **JON-02** Scanning `qpeer://q/<id>` with the phone's camera opens the app on the join screen
- [ ] **JON-03** Join screen shows the business, queue, people waiting and the wait range **before** joining
- [ ] **JON-04** Location check: permission request, one high-accuracy reading, `accuracy` and `mocked` sent. Location is not stored.
- [ ] **JON-05** Clear errors: too far, fake location, no fix (> 1 km), queue closed/paused/full, already have a token
- [ ] **JON-06** Location permission denied → explanation, and "ask staff to add you" (x) as the fallback
- [ ] **JON-07** Free-lane strikes: 3 no-shows in 30 days → free joins blocked for a set time, with a clear message

## M5 Token experience

- [ ] **TOK-01** Token screen: big number, now serving, people ahead, wait range, be-back-by / leave-home-by, state badge
- [ ] **TOK-02** Live updates via WebSocket. **Reconnects automatically** after network loss or app background.
- [ ] **TOK-03** Correct state on reopen (fetched fresh, even if alerts were missed)
- [ ] **TOK-04** States shown distinctly: waiting, paused, called (counter N), grace, served, expired, left, cancelled/refunded
- [ ] **TOK-05** Leave queue (confirm dialog). Cancel paid token (shows refund or no-refund before confirming).
- [ ] **TOK-06** "My tokens" list: active first, then recent history. Empty state.
- [ ] **TOK-07** Directions button opens the phone's maps app at the business pin

## M6 Alerts

- [ ] **ALR-01** Ask notification permission at the right time (first join), with an explanation
- [ ] **ALR-02** Register the Expo push token. **Update it when it changes.** Remove it on sign-out.
- [ ] **ALR-03** Alerts: head back now, you're next, called (counter N), grace started, refund issued, queue paused/closed
- [ ] **ALR-04** No duplicate alerts (flags per token per alert type)
- [ ] **ALR-05** Tapping an alert opens that token's screen
- [ ] **ALR-06** Android notification channel with high importance. In-app guide to turn off battery optimisation.
- [ ] **ALR-07** Business console alerts: late arrival waiting in grace (optional sound)

## M7 Map & discovery

- [ ] **MAP-01** Map centred on the user's location (with permission) or Jammu by default
- [ ] **MAP-02** Markers show live waiting count and open/closed. Clustering when zoomed out.
- [ ] **MAP-03** Data refreshes when the map moves and every ~30 s while visible
- [ ] **MAP-04** List view sorted by distance / wait / name. Category filter. "Open now" filter.
- [ ] **MAP-05** Business detail: queues with live wait, hours, address, public stats (average wait, average service time over 4 weeks), Reserve and "how to walk in" actions
- [ ] **MAP-06** Empty area / no results / offline / loading states
- [ ] **MAP-07** Recenter-on-me button. Location permission denied still shows the map.

## M8 Payments (Razorpay test mode)

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
- [ ] **EXT-02** Priority Pass as a queue setting (limit per N regular tokens; 0 = no limit), shown to regular customers
- [ ] **EXT-03** Verified reviews: one per served token within 7 days; stars + text; rating on the business detail

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
