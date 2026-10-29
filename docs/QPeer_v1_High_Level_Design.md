# QPeer v1: High-Level Design (Working Demo)

**Status:** agreed, ready to build · **Date:** 13 October 2026

Version 1 is a **working end-to-end demo**, not a real-world pilot. Everything in the demo script below must work for real (real app, real backend, real map, Razorpay in **test mode**). Anything not needed for the demo is left for later.

Related documents: `QPeer_Platform_Architecture_and_Build_Plan.md` (full platform plan), `QPeer_SRS.docx` (requirements), `tooling.md` (tools and setup for building this).

---

## 1. Goal and Demo Script

The demo is finished when this script runs from start to end on real Android phones:

1. **A business signs up** (Google or phone login), creates a profile, **drops a pin on the map**, creates a queue and gets its QR code.
2. **A customer opens the map** and sees the business with its live waiting count, wait estimate, and public stats (average wait, average service time).
3. **The customer reserves a place from the map** and pays with Razorpay test mode. They receive a token and a "leave home by" time.
4. **A second customer joins as a walk-in** by scanning the QR code and passing the GPS check.
5. **The business taps Next.** Customers' positions and wait estimates update live, and alerts arrive.
6. **No-show path:** a remote customer is marked no-show, the grace period ends (MISSED), they never rejoin, the ticket expires, the fee is forfeited and the split is recorded. **Cancel path:** a customer cancels in time and is refunded.
7. **The business opens Analytics and Earnings** and sees peak hours, trends, average waits and income.

### Scope

| | Version 1 |
|---|---|
| **Must have** | Business account, profile, pin, queue, QR · customer map + business detail with public stats · walk-in join with GPS check · remote reservation with Razorpay test mode, deposits, refunds, split ledger · Priority Pass and upgrade behind a per-business setting (decided 2026-10-18, §5.2) · queue console (Next, Skip, Pause/Resume, No-show, Grace, Admit late, Close) · live position, wait range, alerts · business analytics and earnings · demo data generator |
| **Extras if time allows** | Staff "Add person" with claim code · verified ratings (decided 2026-10-18, §6.7) |
| **Not in v1** | Live payments, iOS, billing-software integrations, TV display, admin tools, comparison with nearby businesses, languages other than English, Bluetooth |

---

## 2. Locked Decisions

| Area | Decision |
|---|---|
| Platform | **Android only** for v1. The code stays cross-platform. |
| App | **Expo (React Native) + TypeScript**, Expo Router, **EAS cloud builds** (development builds) |
| One app | **Customer mode + Business mode** in the same app |
| Backend | **Cloudflare Workers** (Hono) + **Durable Objects** (one per queue, SQLite-backed) + **D1** + **Cron Triggers**, all on the free plan |
| Database access | **Drizzle ORM** (D1 / SQLite dialect) with `drizzle-kit` migrations |
| Login | **Firebase Auth**: Anonymous (walk-ins), Google Sign-In and Phone OTP (paying customers and businesses). **Test phone numbers** for the demo. |
| Push alerts | **Expo Notifications** through Firebase Cloud Messaging, sent from the Worker through the Expo Push API |
| Map | **Mapbox** via `@rnmapbox/maps` (Expo config plugin, Mapbox Maps SDK v11). The demo uses Mapbox's **no-card trial** with a public token. A card is added before any real launch (free tier: 25,000 monthly active users). |
| Payments | **Razorpay test mode**: Orders API + Checkout SDK + Refunds API + signed webhooks. The revenue split is recorded in our ledger (Razorpay Route if available in test mode). |
| Walk-in check | Static QR + **forgiving GPS check** (150 m default radius) + Android mock-location rejection |
| Repo | One **npm workspaces** monorepo, TypeScript everywhere, shared types and validation (zod) |

---

## 3. System Overview

```text
 ┌──────────────── Android app (Expo) ────────────────┐
 │  Customer mode: Map · Business · Scan · My token   │
 │  Business mode: Onboarding · Console · Analytics   │
 └───────┬───────────────────┬──────────────┬─────────┘
         │ HTTPS (Firebase   │ WSS (live    │ Razorpay Checkout
         │ ID token)         │ queue)       │ (test mode)
 ┌───────▼───────────────────▼──────┐       │
 │ Cloudflare Worker: "qpeer-api"   │◄──────┼── Razorpay webhooks
 │ Hono routes · auth · validation  │       │
 └──┬──────────────┬─────────────┬──┘       │
    │              │             │          ▼
    │ D1 (Drizzle) │ Durable     │      Razorpay
    │ businesses,  │ Object      │      (Orders, Refunds)
    │ users,       │ "QueueDO"   │
    │ payments,    │ one per     ├──► Expo Push API ──► FCM ──► phones
    │ ledger,      │ queue       │
    │ snapshots,   │             │
    │ analytics    │             │
    └──────────────┴─────────────┘
         ▲
   Cron Triggers: expiry clean-up, payment reconciliation
```

**Responsibilities:**

- **Worker (API):** authentication, input validation, business and map data, payments, and routing each queue request to its Durable Object.
- **QueueDO:** the single source of truth for one live queue. It handles numbering, order, states, wait estimates, grace timers, live WebSocket updates and alert triggers.
- **D1:** everything that isn't a live queue: businesses, users, payments, ledger, map snapshots, analytics, and finished token history.

---

## 4. Mobile App

### 4.1 Screens (Expo Router)

```text
app/
├── (auth)/sign-in            Google / phone (test numbers) · anonymous happens silently
├── (customer)/
│   ├── map                   Map + list toggle, category filter, markers with live waits
│   ├── business/[id]         Stats, wait now, Reserve / Walk-in info
│   ├── scan                  Camera QR scan → location check → join
│   ├── token/[id]            Big number, now serving, people ahead, wait range,
│   │                         be-back-by / leave-home-by, Leave / Cancel,
│   │                         Check in (Priority Pass), Skip ahead offer, Rate
│   └── checkout/[queueId]    Fee, rules, Razorpay Checkout
├── (business)/
│   ├── onboarding            Profile, category, pin drop, hours
│   ├── queues                List + create queue + QR display/share
│   ├── console/[queueId]     Now serving, Next, Skip, Pause, No-show, grace list, Close
│   ├── analytics             Charts + plain-language insights
│   ├── earnings              Payments, refunds, forfeits, shares
│   └── settings              Radius, walk-in quota, fees, grace time, rejoin delay + late window, Priority Pass
└── profile                   Mode switch (Customer ↔ Business), sign out
```

### 4.2 Main libraries

| Need | Library |
|---|---|
| Navigation | Expo Router |
| Server data and caching | TanStack Query |
| Typed API client | Hono RPC client (`hc<AppType>`) with types from the API package |
| Forms and validation | react-hook-form + zod (schemas shared with the API) |
| Map and markers | @rnmapbox/maps: a GeoJSON source with built-in clustering + symbol layers for live-wait markers, MarkerView for the selected business |
| QR scan / QR display | expo-camera (built-in barcode scanning) / react-native-qrcode-svg |
| Location | expo-location (gives `accuracy` and Android `mocked`) |
| Login | @react-native-firebase/app + /auth, Google Sign-In module |
| Push | expo-notifications |
| Payments | react-native-razorpay (may need a small Expo config plugin) |
| Charts | react-native-gifted-charts |

### 4.3 Deep link
The QR code encodes `qpeer://q/<queueId>`. Scanning it with the phone camera opens the app on the Scan screen. The in-app scanner reads the same format.

---

## 5. Backend

### 5.1 API (Hono on Workers), version prefix `/v1`

| Group | Endpoints |
|---|---|
| Me | `GET /me` · `POST /me/push-token` · `POST /me/mode` |
| Map | `GET /map?bbox=&category=` → snapshots + business summaries |
| Businesses | `POST /businesses` · `PATCH /businesses/:id` · `GET /businesses/:id` (public detail + stats) |
| Queues (owner) | `POST /businesses/:id/queues` · `PATCH /queues/:id/settings` · `GET /queues/:id/qr` |
| Join | `POST /queues/:id/join/walkin` `{lat, lng, accuracy, mocked}` |
| Reserve / pay | `POST /queues/:id/orders` `{kind: reservation \| priority}` → Razorpay order · `POST /tokens/:id/upgrade` → Razorpay order (Skip ahead) · `POST /payments/verify` · `POST /webhooks/razorpay` |
| Tokens | `GET /tokens/:id` · `POST /tokens/:id/leave` · `POST /tokens/:id/cancel` · `POST /tokens/:id/rejoin` `{lat, lng, accuracy, mocked}` ("I'm here" after MISSED) · `POST /tokens/:id/checkin` `{lat, lng, accuracy, mocked}` (Priority Pass on arrival) · `POST /tokens/:id/rating` `{experience, service}` (x) |
| Live | `GET /queues/:id/live?token=` (WebSocket upgrade, forwarded to QueueDO) |
| Console (staff) | `POST /queues/:id/{next, skip, pause, resume, close}` · `POST /queues/:id/tokens/:tid/{noshow, admit}` |
| Insights | `GET /businesses/:id/analytics?range=` · `GET /businesses/:id/earnings?range=` |
| Dev only | `POST /dev/seed`, `POST /dev/simulate` (disabled outside the dev environment) |

The Worker forwards queue operations to `env.QUEUE.idFromName(queueId)`.

### 5.2 QueueDO (one per queue)

**State** (in the Durable Object's own SQLite storage):

- `meta`: status (open / paused / closed), next regular number, next priority number, now serving, settings snapshot, EWMA interval and variance, last Next time
- `tokens`: id, number, class (`triage` / `priority` / `regular`), method (`walkin` / `remote` / `staff`), owner uid, state, joined_at, called_at, counter, grace_until, alert flags
- `hourly`: counters for the current hour, flushed to D1

**Ticket states:** **BOOKED** (Priority Pass paid, not yet in the line; added 2026-10-18), WAITING, CALLED, GRACE, **MISSED** (added 2026-10-18), SERVED, EXPIRED, LEFT, CANCELLED. A ticket is active while BOOKED, WAITING, CALLED, GRACE or MISSED. BOOKED and MISSED tickets are not in the live order and do not count as waiting.

**Order (updated 2026-10-18):** two lanes. The regular lane is ordered by join sequence. A remote reservation gets its place in the sequence **when payment is confirmed**. The priority lane is ordered by check-in time (or upgrade time). Next follows the rule in "Priority Pass" below: triage first, then the head of the priority lane when it is due, else the next regular. A ticket that rejoins after MISSED goes behind a number of waiting people set from the business's rejoin delay (see below). Staff never move a ticket by choice.

**People ahead:** an indexed `COUNT` of waiting tokens before mine in that order. With SQLite inside the Durable Object this is fast for thousands of tokens, so v1 doesn't need the Fenwick tree from the earlier design. Add it only if profiling shows a need. With the priority lane on, a regular's people ahead also includes the expected priority calls (see "Priority Pass").

**Missed turn and late arrival (decided by the owner, 2026-10-18).** The same rules apply to walk-ins and remote joiners.

1. The person is called but is not there. Staff tap **No-show**. The ticket enters GRACE (business setting, for example 10 min). The existing `grace_started` alert tells the person "you were called, come now". Staff keep calling others. Nobody is blocked.
2. The person arrives during GRACE. Staff tap **Admit**. The person is served right after the current person. They lose no place.
3. GRACE ends. The ticket becomes **MISSED** (not EXPIRED). One push alert is sent (kind `missed`): "You missed your turn. Tap I'm here when you arrive." The ticket screen says: "You missed your turn. When you're here, tap I'm here to rejoin." (R3, decided 2026-10-18.) During GRACE the ticket screen shows a large live countdown, "Come now — m:ss left", on the server-corrected clock.
4. The person taps **I'm here**. The app runs the same GPS walk-in check as joining (location is never stored; mocked locations are rejected). This is allowed **once per ticket**. Rejoins at the same time are ordered by tap time (the server receive time of a successful check). Where the ticket goes depends on two business settings (R1, decided 2026-10-18):
   - **Rejoin delay** `rejoinDelayMin` (default 15 min). The penalty is minutes of service, not a fixed number of people. The engine turns it into people with the queue's own service-time estimate (the EWMA interval between Next calls; the configured service time at cold start): behind ceil(rejoinDelayMin ÷ avgServiceMin) WAITING people, at least 1. If fewer wait, the ticket goes to the end. Example: a clinic at 3 min per person → behind 5. A salon at 30 min per person → behind 1.
   - **Late window** `lateWindowMin` (default 15 min; the business can raise it or set "no limit"). "I'm here" within the window after MISSED → the rejoin-delay rule above. After the window → the end of the line.
   - **Skip uses the same delay** (decided 2026-10-18). A staff Skip moves the ticket behind the same number of WAITING people of its own class, worked out the same way, or to the end if fewer wait. The number is fixed at the moment of the skip. The class rule stays: a skipped regular or priority ticket never goes inside a higher class; a skipped triage ticket may go behind lower classes.
5. The person misses a second time, or never rejoins before the queue closes (or the business limit) → EXPIRED. A MISSED ticket never carries over to the next session, even with a multi-day ticket validity (R4). A free walk-in also gets one no-show strike. The existing rule stays: 3 strikes in 30 days block free joins for 7 days, per user and per device hash. Paid tickets (remote reservation, Priority Pass) get no strike: losing the fee is the penalty (C5, decided 2026-10-18).
6. A ticket moves back only when its owner asks to rejoin. Staff never reposition it. People ahead for others: no change when a called ticket becomes No-show or MISSED. On a rejoin, only the people behind the insert point get +1.
7. Remote join fee: see §6.3.
8. This replaces the dropped idea "NEXT calls only checked-in people" (presence tracking is unreliable). Check-in is used only for rejoin after MISSED and for Priority Pass activation.
9. Engine details (R4, decided 2026-10-18): a missed priority or triage holder rejoins inside their own class (the skip class rule, G1). Analytics count a ticket served after a rejoin as served, count each miss as a no-show, and leave the time away out of wait statistics.
10. **Staff "Rejoin for customer"** (R2, decided 2026-10-18). Every ticket gets a 4-character check code when it is made, shown under the number: "#14 · K7P2". The code uses no look-alike characters (no 0/O, 1/I/L). It is stored on the ticket and is part of the signed ticket. After MISSED, staff can rejoin a person whose phone is dead. They need the ticket number + check code, or a scan of a valid signed QR. The same once-only rule and the same position rule as "I'm here" apply. If the person knows neither, staff serve them as a new walk-in. Staff never move a ticket by choice. Details: backend doc §23.

**Misuse and edge cases (decided by the owner, 2026-10-18):**

| Case | What happens |
|---|---|
| Joins, goes shopping, comes back late on purpose | One rejoin, behind about `rejoinDelayMin` minutes of service; after the late window, to the end of the line (R1). A second miss expires the ticket and adds a strike (free walk-ins only; a paid ticket loses its fee instead). |
| Misses on purpose again and again across days | 3 no-shows in 30 days block free joins for 7 days (built, also per phone). |
| Reinstalls the app for a fresh ticket | Blocked by the device check (built). |
| Takes tickets in many queues "just in case" | One per queue. Each miss adds a strike. Optional later: a limit on active free tickets per person. |
| Taps "I'm here" from home | Location check, the same 150 m rule as joining. |
| Staff mark someone No-show by mistake | The customer got the alert and Grace protects them. Every action is logged with its time for later review. |
| Fewer waiting at rejoin than the rejoin delay needs | To the end of the line. |
| Two missed people rejoin at the same time | Each gets the same rule, in tap order. |
| Taps "I'm here" with a fake location | Rejected, like a join (R4). |
| Phone dead at the counter | During GRACE: staff look up the number or scan the saved ticket QR, then Admit. After MISSED: staff rejoin them with the ticket number + check code (R2). If they know neither, staff serve them as a new walk-in. |
| Called person is inside but didn't hear | The alert plus Grace covers it, with the large countdown on the ticket. Admit serves them next. |

R1, R2, R3 and R4 were decided by the owner on 2026-10-18 (backend architecture doc §23).

**Priority Pass, "flexible pass" (decided by the owner, 2026-10-18; built in Step 4).** This replaces the proposal of the same day and the older "VIP: pay to skip" idea (both superseded 2026-10-18). There are no time slots. The pass is a paid pass for one queue. It enters the line when the holder arrives.

Lifecycle:
1. **Buy.** Signed-in, non-anonymous accounts only. The business sets the price and the validity window (default "today"; hours to days). Before paying, the app shows an honest preview: "Priority holders wait about X min · regular wait about Y min · you save about Z min". The ticket is created only after the server confirms the payment (verify + webhook), never from the client alone. Payment not confirmed → no ticket.
2. **BOOKED.** Paid, not yet in the line. The holder can be anywhere.
3. **Check in on arrival.** GPS within the queue's join radius (the walk-in check). A photo of the counter QR alone is not enough. Mocked locations are rejected. The ticket then enters the **priority lane**, ordered by check-in time (not purchase time).
4. **Called and served** through Next (rule below). Priority tickets have their own number series: P1, P2… Missed-turn rules are the same as for everyone: Grace → Missed → one rejoin → Expired.
5. Once checked in, the validity window no longer matters. The holder stays until served or until the queue closes.

**Upgrade ("Skip ahead", v1, the main revenue path).** A WAITING ticket shows "Skip ahead for ₹X, about N min faster". Paying moves that same ticket into the priority lane at the upgrade time. No check-in is needed: the person is already present. One active ticket per person per queue: buying a pass while holding a ticket upgrades it, never a second ticket. Only WAITING tickets can upgrade (not CALLED, GRACE or MISSED). The offer is hidden when the estimated saving is below a threshold (default 5 min). The app never shows "save ~0 min" next to a price (C2).

**Next rule** (enforced by the engine; staff cannot pick a priority person by hand):
- Triage first (existing daily cap).
- Else call the head of the priority lane if it is **due**, else the next regular.
- Due = a credit counter. Each regular call adds 1 credit. A priority call costs N credits (N = the business ratio "1 priority per N regulars"). Credits are capped at N, so there is no burst after a quiet period. If no priority holder waits, regulars go on as normal.
- The counter starts at 0 when a session opens: the first priority holder waits N regular calls, with no instant jump at opening. Triage calls add no credit. A regular call adds a credit even if it ends as No-show. Undo of Next also undoes the credit change (C1).

**Business settings** (all set by the business; no platform limits): priority on/off (default OFF), price, ratio N (any whole number ≥ 1, so 1-in-1 is allowed; the form prefills 1-in-2 when switched on), optional daily sales cap ("Sold out"), validity window, cancel refund % (default 50).

**What regulars see.** "Priority lane on · 1 in N" on the business page, the join screen and the ticket. Their people ahead and wait estimate include the expected priority calls, shown as a range (C3): the low end counts only priority holders already checked in; the high end assumes every N-th call goes to priority. The shared estimate and the load-test people-ahead invariant use the same rule (Step 4 work).

**Money** (see also §6.3):

| Case | Fee |
|---|---|
| Served | Kept, split business / Qpeer (demo 70/30) |
| Cancelled by the customer before check-in | Refund at the business's % (default 50) |
| Never checked in by the end of the window | No refund |
| Checked in, then missed and never rejoined | No refund |
| Checked in, but the queue closed before serving them | Full refund, automatic |
| The business cancels or closes early | Full refund, automatic |
| Queue closed while paused (C6) | Counts as "closed before serving": every checked-in holder gets a full refund |

Checked-in priority holders never carry over to the next day, even with a multi-day window. They get a refund instead (C6).

**Misuse:**
- The pass is tied to the buyer's account. It cannot be transferred.
- 1 pass per account per queue per day. The device hash is recorded on purchases and upgrades, so the same phone cannot buy a second pass with another account (the device-hash rule now covers paid priority too).
- Check-in needs GPS. A fake check-in only leads to Grace → Missed for the person who faked it.
- Every call is logged with its time, so staff favouritism can be audited.
- Paid tickets that miss get no no-show strike. Losing the fee is the penalty. Strikes stay for free walk-ins only (C5).
- The signed ticket QR carries only the first name and the last 4 phone digits. The QR is signed, not encrypted. Staff see the full name in the console when online (C4).

**Why no platform cap (owner).** Businesses decide. Public ratings (§6.7) penalise unfair use: regulars rate low, the business's reputation drops on the map, and customers switch to other places.

Fits OPD, government offices, labs, service centres and salons. Doctors with long fixed sessions need time-slot appointments instead: a separate, later feature, not v1. Optional later: a customer "Running late" button that moves the person back N places by choice, before they are called.

**Wait estimate:** an EWMA of the intervals between Next calls (paused time excluded, outliers capped at 5× the recent median), plus an exponentially weighted variance for the range. The estimated call time = the remainder of the current interval + people ahead × EWMA. The range uses the variance (see the earlier ETA documents). With the priority lane on, people ahead is itself a range (C3, see "Priority Pass"), and the shown range covers both ends.

**Timers:** a Durable Object has **one alarm**, so QueueDO keeps a small scheduler and always sets the alarm to the earliest of:
- the next grace-period expiry
- the next snapshot flush (at most every 30 s while something changed)
- the hourly analytics flush

**Live updates:** WebSocket Hibernation API. Each socket is tagged with its token. After each change, every socket gets its own small update (now serving, people ahead, wait range).

**Alerts:** when a token crosses "head back now" (call time minus travel buffer), "you're next" or "called (counter N)", QueueDO asks the Worker to send an Expo push, and records the flag so the alert isn't sent twice.

**Idempotency:** allocations from payments are keyed by the Razorpay order ID. A repeated call returns the same token.

### 5.3 D1 schema (Drizzle)

| Table | Key columns |
|---|---|
| `users` | id, firebase_uid (unique), is_anonymous, phone, email, display_name, created_at |
| `devices` | user_id, expo_push_token, updated_at |
| `businesses` | id, owner_user_id, name, category, address, lat, lng, geohash, hours_json, status, created_at |
| `business_members` | business_id, user_id, role (owner / staff) |
| `queues` | id, business_id, name, status, settings_json (radius, walk-in quota, fees, grace minutes, rejoin delay, late window, Priority Pass settings, split %) |
| `queue_snapshots` | queue_id (pk), business_id, lat, lng, waiting, eta_low_s, eta_high_s, is_open, updated_at |
| `token_history` | id, queue_id, number, class, method, user_id, final_state, joined_at, called_at, served_at |
| `payments` | id, user_id, queue_id, token_id, kind (reservation / priority / upgrade), amount_paise, device_hash (priority and upgrade), razorpay_order_id (unique), razorpay_payment_id (unique), status, created_at |
| `ledger_entries` | id, payment_id, business_id, kind (capture / refund / forfeit / business_share / platform_share), amount_paise, created_at (**append-only**) |
| `analytics_hourly` | queue_id, hour_start, joins, leaves, served, no_shows, sum_wait_s, sum_interval_s, intervals, eta_hits, eta_total |
| `free_lane_strikes` | user_id, strikes, window_start |
| `ratings` (x) | id, token_id (unique), business_id, user_id, lane (regular / priority), experience_stars, service_stars, created_at |

Multi-table writes (for example payment + ledger rows) use **D1 batches**, which run as one transaction.

### 5.4 Cron Triggers

- **Every 15 min:** close queues past closing time, and expire stale orders that were never paid.
- **Daily:** reconcile `payments` with Razorpay's records and log any mismatch.

Analytics trends are calculated **when requested**, from `analytics_hourly`, so v1 doesn't need a rollup job.

---

## 6. Key Flows

### 6.1 Business onboarding
Sign in (Google / phone) → onboarding form → pin drop → `POST /businesses` → `POST /businesses/:id/queues` → QR shown and shareable. A snapshot row is created, so the business appears on the map straight away (closed until the queue opens).

### 6.2 Walk-in join
```text
Scan QR → app reads queueId → expo-location (high accuracy, once)
→ POST /join/walkin {lat, lng, accuracy, mocked}
→ Worker: reject if mocked or accuracy > 1000 m;
          accept if distance(pin) − accuracy ≤ radius; check strikes
→ QueueDO.allocate(walkin, uid) → token → app opens token screen + WebSocket
(location is never stored)
```

### 6.3 Remote reservation (Razorpay test mode)
```text
Customer (signed in, not anonymous) taps Reserve
→ POST /orders → Worker checks with QueueDO: no active ticket of this person in the queue,
  walk-in quota → creates Razorpay order
→ app opens Razorpay Checkout → success callback {order_id, payment_id, signature}
→ POST /payments/verify → Worker verifies signature (HMAC) → QueueDO.allocate(remote, orderId)
→ webhook payment.captured → same idempotent allocate (whichever arrives first wins)
→ D1 batch: payment captured + ledger capture + business_share + platform_share
If the quota filled up in between, or the person got another active ticket here → automatic refund + ledger refund
```

**One active ticket per person per queue, paid reservations too (owner, 2026-10-18; enforced for reservations 2026-10-30).** A person who already holds any active ticket in the queue (booked, waiting, called, in grace or missed) can't buy a reservation there: the server answers "already in queue" with that ticket and the app opens it. The old setting "paid tickets per person" (2) is retired.

**Fee after a missed turn (decided 2026-10-18, built in Step 4):** the fee is kept only if the ticket expires and the person never arrived. If the person is served, even after a rejoin, the fee paid for holding the place (no refund). If the business cancels or closes early, the fee is refunded. A paid ticket that misses gets no no-show strike (C5).

**Priority Pass purchase (decided 2026-10-18, Step 4):**
```text
Customer (signed in, not anonymous) taps Buy Priority Pass
→ app shows the preview: priority wait ~X min · regular wait ~Y min · save ~Z min
→ POST /orders {kind: priority, deviceHash} → Worker checks: priority on, not sold out,
  1 pass per account and per device hash per queue per day, no active ticket in this queue
  (holding a WAITING ticket → the app offers the upgrade instead)
→ Razorpay Checkout → verify + webhook (same idempotent confirm as a reservation)
→ QueueDO books the pass → ticket BOOKED (not in the line yet)
→ on arrival: POST /tokens/:id/checkin {lat, lng, accuracy, mocked} → walk-in GPS check
→ ticket WAITING in the priority lane, P number, ordered by check-in time
```

**Upgrade "Skip ahead" (decided 2026-10-18, Step 4):**
```text
WAITING ticket, estimated saving ≥ threshold (default 5 min) → offer "Skip ahead for ₹X, ~N min faster"
→ POST /tokens/:id/upgrade {deviceHash} → same checks as a pass → Razorpay order
→ verify + webhook → QueueDO moves the same ticket into the priority lane at the upgrade time
  (only if it is still WAITING; otherwise automatic full refund)
```

Priority fee rules (served, cancel before check-in, never checked in, missed, closed before serving): §5.2 "Priority Pass".

### 6.4 Calling, no-show, grace and forfeit
```text
Staff taps Next → QueueDO picks triage, else a due priority holder, else the next regular
  (credit counter, §5.2) → interval recorded → updates + alerts
Staff taps No-show → token enters GRACE (default 10 min) → alarm set → alert grace_started
  • arrives in time → staff taps Admit → served next
  • alarm fires → MISSED (out of the live order) → alert missed
      • taps "I'm here" + GPS check (once per ticket)
          within lateWindowMin → WAITING behind ceil(rejoinDelayMin ÷ avgServiceMin) (≥ 1, or the end)
          after the window     → WAITING at the end of the line
      • misses again, or never rejoins by close → EXPIRED
        → remote/priority: ledger "forfeit" + shares; free walk-in: strike +1
```
Rules and edge cases: §5.2 "Missed turn and late arrival" (decided 2026-10-18).

### 6.5 Cancel and refund
A customer cancels before the cancel window closes → Worker calls the Razorpay Refunds API → ledger refund → token LEFT. After the window, cancelling = leaving without a refund.

Priority Pass (2026-10-18): a customer who cancels a BOOKED pass (before check-in) gets the business's cancel refund % (default 50) back. After check-in, cancelling = leaving without a refund. Full refunds when the queue closes before serving a checked-in holder, or when the business cancels or closes early, are automatic.

### 6.7 Ratings (decided by the owner, 2026-10-18; Step 6 extra)
Verified ratings, in the style of Trustpilot (stars only).
- Every SERVED customer gets an in-app option to rate two things, 0–5 stars each: **customer experience** and **service quality**.
- Ratings show on the map, the business card and the business page, where people decide which queue to join.
- Purpose: they close the fairness loop. A business that favours priority too much gets low ratings from regulars and loses customers to other places.
- Each rating stores the lane (regular or priority) of the rated ticket.
- Stars only, no written text.

Decided by the owner, 2026-10-18:
- **RT1** Ratings are shown split by lane: "Regular customers 2.1★ · Priority customers 4.8★", next to "Priority lane on · 1 in N", so a blended average cannot hide unfairness.
- **RT2** Integrity: only a served ticket can rate, once per ticket. Ratings show only after at least 5 ratings (counted per lane). The business cannot delete ratings but can reply in public.

Recorded note (not a rule):
- **RT3** Known limit: for a monopoly provider (the only hospital nearby), ratings do not move customers, but they stay public evidence for oversight.

### 6.6 Map
`GET /map?bbox` → one D1 query on `queue_snapshots` joined with `businesses` (an index on lat/lng with a bounding box) → markers with waiting count and wait range, at most about 30 s old.

---

## 7. Security Model

- **Every request** carries a Firebase ID token. The Worker verifies it against Google's public keys (a JWT library, keys cached) and maps `firebase_uid` → our `users.id`.
- **Anonymous users** may only view the map, join as walk-ins and manage their own tokens. **Paying and business actions** require a non-anonymous account. An anonymous account can be upgraded in place, keeping its tokens.
- **Business actions** check `business_members` roles (owner / staff).
- **Razorpay:** the client callback is checked with the payment signature, and webhooks are checked with the webhook secret. The **key secret exists only on the Worker.**
- **Rate limits:** per user on join, order and OTP-related endpoints (counters in QueueDO / D1).
- **Secrets:** Wrangler secrets (deployed) and `.dev.vars` (local, gitignored). No secrets in the app bundle.

---

## 8. Demo Data Generator

Real-looking analytics need weeks of history, so `scripts/` contains:

- **`seed`:** creates 8–15 businesses (clinics, labs, service centres, salons) around a chosen city centre, with queues, plus **4–8 weeks of synthetic `analytics_hourly`** rows (weekday peaks, a slow upward trend, realistic no-shows) and a few past payments for Earnings.
- **`simulate`:** drives a live queue through the API at a faster pace (joins, Next, leaves, no-shows), so the map and console move during a demo without a crowd of phones.

Both run only against the **dev** environment.

---

## 9. Environments and Configuration

| Environment | Backend | Used for |
|---|---|---|
| `local` | `wrangler dev` (local D1 + Durable Objects) | Fast development and tests |
| `dev` | Deployed Worker `qpeer-api-dev` + D1 `qpeer-dev` | Phone testing, Razorpay webhooks (need a public URL), seeding |
| `demo` | Deployed Worker `qpeer-api` + D1 `qpeer-demo` | The demo itself, with clean seeded data |

**Demo settings (placeholders, not business decisions):** reservation fee ₹20, priority fee ₹100, business share 70%, grace 10 min, walk-in quota 50%, join radius 150 m, cancel window up to 15 min before the estimated call. Priority Pass (2026-10-18): OFF by default; when switched on the form prefills 1 priority per 2 regulars, validity "today", cancel refund 50%, no daily cap, upgrade offer hidden below 5 min saving.

---

## 10. Repository Layout

```text
qpeer/
├── apps/
│   ├── mobile/            Expo app
│   └── api/               Worker, QueueDO, Drizzle schema + migrations, wrangler.jsonc
├── packages/
│   └── shared/            zod schemas, types, ETA math, ordering rules, geo distance, fee split
├── scripts/               seed, simulate
├── docs/                  design documents
├── CLAUDE.md / AGENTS.md  conventions for Claude and the engines
└── NOTES.md               build progress and handoff
```

---

## 11. Testing

| Level | Tool | Covers |
|---|---|---|
| Unit | Vitest (`packages/shared`) | ETA math, ordering, geo check, fee split, quota rules |
| Backend integration | Vitest + `@cloudflare/vitest-pool-workers` (real local Durable Objects + D1) | Concurrent joins never duplicate numbers, grace alarm expiry, idempotent payment allocation, quota race → refund, people-ahead after leaves |
| App | Typecheck + a few component tests (jest-expo) | Screens render, forms validate |
| On device | A short checklist per build step, plus optional Maestro flows | The demo script |

`npm run check` (typecheck + lint + all tests) is the single "done" check for every build step.

---

## 12. Build Steps

| Step | Builds | Done when |
|---|---|---|
| **0. Foundations** | Monorepo, Expo app + dev build on phone, Firebase login (anonymous + Google + test phone), Worker + D1 + QueueDO deployed to `dev`, Drizzle migrations, `npm run check` | The app on the phone signs in and calls an authenticated `/me` on the deployed Worker |
| **1. Business** | Onboarding, pin drop, queues, QR | A business created on the phone appears in D1 with a working QR |
| **2. Queue core** | Walk-in join with GPS, console, live position, wait range, grace, alerts | Two phones: join → Next → live update + alerts. Integration tests pass. |
| **3. Map** | Snapshots, map + markers + list, business detail with public stats | The seeded businesses and live counts show on the map, updating within 30 s |
| **4. Payments** | Accounts upgrade, orders, Checkout, verify + webhook, refunds, ledger, missed-turn rules, Priority Pass + check-in + upgrade + Next credit rule (§5.2, decided 2026-10-18) | Test payment → token. No-show → forfeit recorded. Cancel → refund recorded. Pass → check-in → called by the 1-in-N rule. |
| **5. Insights + demo data** | Analytics and earnings screens, seed and simulate scripts | The full demo script runs end to end on the `demo` environment |
| **6. Extras** | Add person + claim code, verified ratings (§6.7). Priority Pass moved to Step 4 (2026-10-18). | Only if time allows |

---

## 13. Project Identity (decided 14 October 2026)

| Item | Decision |
|---|---|
| **Android package name** | `com.qpeer.app` (Firebase and the signing key are tied to it; don't change it) |
| **App name** | **Qpeer** (shown under the icon and on the Google sign-in screen; icon still to be designed, a placeholder is used until then) |
| **Demo city** | **Jammu, J&K, India**. Seed data is centred on about 32.73° N, 74.86° E and spread across the city's main neighbourhoods. |
| **Repository location** | `G:\dev\qpeer` (local git repository on this laptop) |

Later decisions (real fees, OTP provider for real SMS) stay in the SRS TBD list and don't block v1. The Priority Pass rules were decided by the owner on 2026-10-18 (§5.2).
