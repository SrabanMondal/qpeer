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
6. **No-show path:** a remote customer is marked no-show, the grace period expires, the fee is forfeited and the split is recorded. **Cancel path:** a customer cancels in time and is refunded.
7. **The business opens Analytics and Earnings** and sees peak hours, trends, average waits and income.

### Scope

| | Version 1 |
|---|---|
| **Must have** | Business account, profile, pin, queue, QR · customer map + business detail with public stats · walk-in join with GPS check · remote reservation with Razorpay test mode, deposits, refunds, split ledger · queue console (Next, Skip, Pause/Resume, No-show, Grace, Admit late, Close) · live position, wait range, alerts · business analytics and earnings · demo data generator |
| **Extras if time allows** | Staff "Add person" with claim code · Priority Pass as a setting · simple reviews |
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
│   │                         be-back-by / leave-home-by, Leave / Cancel
│   └── checkout/[queueId]    Fee, rules, Razorpay Checkout
├── (business)/
│   ├── onboarding            Profile, category, pin drop, hours
│   ├── queues                List + create queue + QR display/share
│   ├── console/[queueId]     Now serving, Next, Skip, Pause, No-show, grace list, Close
│   ├── analytics             Charts + plain-language insights
│   ├── earnings              Payments, refunds, forfeits, shares
│   └── settings              Radius, walk-in quota, fees, grace time
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
| Reserve / pay | `POST /queues/:id/orders` `{kind: reservation \| priority}` → Razorpay order · `POST /payments/verify` · `POST /webhooks/razorpay` |
| Tokens | `GET /tokens/:id` · `POST /tokens/:id/leave` · `POST /tokens/:id/cancel` |
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

**Order:** triage first, then priority (subject to the configured limit), then regular, each by join sequence. A remote reservation gets its place in the sequence **when payment is confirmed**.

**People ahead:** an indexed `COUNT` of waiting tokens before mine in that order. With SQLite inside the Durable Object this is fast for thousands of tokens, so v1 doesn't need the Fenwick tree from the earlier design. Add it only if profiling shows a need.

**Wait estimate:** an EWMA of the intervals between Next calls (paused time excluded, outliers capped at 5× the recent median), plus an exponentially weighted variance for the range. The estimated call time = the remainder of the current interval + people ahead × EWMA. The range uses the variance (see the earlier ETA documents).

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
| `queues` | id, business_id, name, status, settings_json (radius, walk-in quota, fees, grace minutes, priority limit, split %) |
| `queue_snapshots` | queue_id (pk), business_id, lat, lng, waiting, eta_low_s, eta_high_s, is_open, updated_at |
| `token_history` | id, queue_id, number, class, method, user_id, final_state, joined_at, called_at, served_at |
| `payments` | id, user_id, queue_id, token_id, kind, amount_paise, razorpay_order_id (unique), razorpay_payment_id (unique), status, created_at |
| `ledger_entries` | id, payment_id, business_id, kind (capture / refund / forfeit / business_share / platform_share), amount_paise, created_at (**append-only**) |
| `analytics_hourly` | queue_id, hour_start, joins, leaves, served, no_shows, sum_wait_s, sum_interval_s, intervals, eta_hits, eta_total |
| `free_lane_strikes` | user_id, strikes, window_start |

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
→ POST /orders → Worker checks walk-in quota with QueueDO → creates Razorpay order
→ app opens Razorpay Checkout → success callback {order_id, payment_id, signature}
→ POST /payments/verify → Worker verifies signature (HMAC) → QueueDO.allocate(remote, orderId)
→ webhook payment.captured → same idempotent allocate (whichever arrives first wins)
→ D1 batch: payment captured + ledger capture + business_share + platform_share
If the quota filled up in between → automatic refund + ledger refund
```

### 6.4 Calling, no-show, grace and forfeit
```text
Staff taps Next → QueueDO calls the next token → interval recorded → updates + alerts
Staff taps No-show → token enters GRACE (default 10 min) → alarm set
  • arrives in time → staff taps Admit → served next
  • alarm fires → EXPIRED → remote/priority: ledger "forfeit" + shares; walk-in: strike +1
```

### 6.5 Cancel and refund
A customer cancels before the cancel window closes → Worker calls the Razorpay Refunds API → ledger refund → token LEFT. After the window, cancelling = leaving without a refund.

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

**Demo settings (placeholders, not business decisions):** reservation fee ₹20, priority fee ₹100, business share 70%, grace 10 min, walk-in quota 50%, join radius 150 m, cancel window up to 15 min before the estimated call.

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
| **4. Payments** | Accounts upgrade, orders, Checkout, verify + webhook, refunds, ledger | Test payment → token. No-show → forfeit recorded. Cancel → refund recorded. |
| **5. Insights + demo data** | Analytics and earnings screens, seed and simulate scripts | The full demo script runs end to end on the `demo` environment |
| **6. Extras** | Add person + claim code, Priority Pass setting, reviews | Only if time allows |

---

## 13. Project Identity (decided 14 October 2026)

| Item | Decision |
|---|---|
| **Android package name** | `com.qpeer.app` (Firebase and the signing key are tied to it; don't change it) |
| **App name** | **Qpeer** (shown under the icon and on the Google sign-in screen; icon still to be designed, a placeholder is used until then) |
| **Demo city** | **Jammu, J&K, India**. Seed data is centred on about 32.73° N, 74.86° E and spread across the city's main neighbourhoods. |
| **Repository location** | `G:\dev\qpeer` (local git repository on this laptop) |

Later decisions (Priority Pass rules, real fees, OTP provider for real SMS) stay in the SRS TBD list and don't block v1.
