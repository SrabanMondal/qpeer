# QPeer: Platform Architecture, Tech Stack & Build Plan

This document turns the marketplace vision (`QPeer_Pitch_Problem_Solution_Impact.md`) into a technical plan. It extends the existing technical documents; it doesn't replace them:

- `QPeer_Privacy_Preserving_Serverless_Queue.md`: queue core, Fenwick tree, fan-out, ETA
- `QPeer_Architecture_Updates_BLE_and_Native.md`: manual fallback and claim codes. BLE is now only an optional strict mode for later; walk-ins use a GPS check (§3.2).
- `QPeer_Edge_Cases_and_Implementation_Deltas.md`: grace period, triage priority, claim codes

The QPeer code will be built by AI coding engines (agy and opencode), coordinated by Claude through the `orchestrate` skill. The plan is therefore designed for **one language (TypeScript), few moving parts, and testable phases**.

---

## 1. What Changes From the Earlier Design

| Area | Before | Now |
|---|---|---|
| Apps | Separate provider app and participant app | **One app** with a Customer mode and a Business mode |
| Ways to join | On-site only (QR + BLE) or manual | On-site (free) + **remote reservation (paid)** + **Priority Pass (paid)** + manual |
| Abuse check | BLE proximity | **GPS check** for walk-ins (rotating screen QR as an upgrade, BLE as optional strict mode later). **Payment** for remote joins and Priority Pass. |
| Identity | Anonymous everywhere | Anonymous walk-in lane. **Light account** (phone OTP) for paid features and reviews. Businesses have verified accounts. |
| New parts | (none) | Map and discovery, payments with revenue split, reviews, analytics with trends |

---

## 2. Tech Stack

### 2.1 Mobile app: Expo (React Native) + TypeScript

- **Expo is React Native** with the tooling already set up. **EAS Build** builds Android and iOS apps **in the cloud**, so you don't need Android Studio or Xcode on this machine. iOS builds don't need a Mac either.
- Native features (maps, payments) need a **development build** instead of Expo Go. EAS builds it once, and you install it on your phone like a normal app.
- **Expo Router** handles navigation, with mode switching between Customer and Business.
- Flutter and Kotlin are not needed.

### 2.2 Backend: Cloudflare Workers (single platform)

| Part | Cloudflare service | Holds |
|---|---|---|
| API | **Workers** + Hono (a small router) | All HTTP endpoints, payment webhooks |
| Live queues | **Durable Objects**: one per queue | Queue state, Fenwick tree, WebSockets, ETA, grace-period alarms |
| Database | **D1** (SQLite) | Businesses, locations, accounts, reservations, payments ledger, reviews, analytics buckets, map snapshot |
| Scheduled jobs | **Cron Triggers** | Daily and weekly analytics rollups, expiry clean-up |
| Files (later) | **R2** | Business photos |

There is one platform, one language and one deploy command, so it is cheap at small scale. A Durable Object per queue is what the earlier documents already proposed.

### 2.3 Other services

| Need | Choice | Note |
|---|---|---|
| Map | **Mapbox** (`@rnmapbox/maps`) | Expo config plugin, works on Android and iOS. The no-card trial covers development and demos. With a card, the free tier is 25,000 monthly active users. We don't need any place search, because businesses drop their own pin when they sign up. |
| Payments | **Razorpay** (Checkout SDK + **Route** for splitting payments with businesses + Refunds) | Needs a registered business entity and KYC. Payments for real-world services normally don't have to use Google Play's billing system, but confirm the current Play and App Store policy. |
| Walk-in location check | `expo-location` | One-time location reading at join, with accuracy and mock-location checks (§3.2) |
| Push alerts | `expo-notifications` + Expo Push Service | Some Indian Android phones (Xiaomi, Oppo, Vivo and others) delay alerts to save battery. The app must guide users to turn off battery optimisation, and live state stays correct on the server either way. |
| Phone OTP (paid users) | Firebase Auth phone sign-in, or an Indian OTP provider (MSG91, 2Factor) | Decide in Phase 4. Bulk SMS in India requires TRAI DLT registration, and OTP providers handle this. |
| Charts | A React Native chart library | For the analytics screens |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` (backend), Jest (app logic) | |

### 2.4 Repository layout

```text
qpeer/
├── apps/
│   ├── mobile/        Expo app (Customer + Business modes)
│   └── api/           Cloudflare Worker + Durable Objects + D1 migrations
├── packages/
│   └── shared/        Types, ETA math (EWMA, ranges), queue rules, validation
└── docs/              These design documents
```

npm workspaces, TypeScript everywhere, and shared types between the app and the API.

---

## 3. How the Main Parts Work

### 3.1 Map and discovery

- A business signs up, drops a pin on the map, chooses a category and sets opening hours. This is stored in D1 with latitude, longitude and a geohash.
- Each queue's Durable Object writes a small **snapshot** to D1 (waiting count, ETA, open or closed) when it changes, at most every ~30 seconds.
- The map asks the API for "snapshots inside this map area", which is **one D1 query**. It never contacts hundreds of live queues at once.
- Markers are grouped when zoomed out, and each marker shows the live wait.
- Ratings and averages come from the analytics and reviews tables.

**Difficulty: moderate.** These are standard map patterns, and the engines can build them. The hard part of the map is business, not code: a map is only useful when it shows enough businesses (see the pitch, Stage 1).

### 3.2 Walk-in joining: static QR + GPS check

**Why a check is still needed:** if anyone could join the free lane from home with a screenshot of the QR, the free lane would become a free reservation and nobody would pay for one. The check only has to make cheating more trouble than the reservation fee is worth.

**How it works:**

1. The customer scans the **static printed QR code**, which gives the app the queue ID.
2. The app reads the phone's location **once** (permission "while using the app").
3. The server accepts the join if the phone **could be** within the business's **join radius** of its map pin. The default radius is **150 m**, and each business can change it.
   - **The check is forgiving.** The phone reports its own uncertainty along with its position, so the server accepts the join when *distance − reported uncertainty ≤ radius*.
   - **Why not be strict:** GPS indoors or in crowded markets can be off by tens or even hundreds of metres. Accepting someone who is actually a few hundred metres away costs nothing, because anyone that close will simply walk over. A strict check would only reject genuine customers.
4. The location is used only for this check and **is never stored**.

**Checks against abuse:**
- Reject readings the phone's operating system marks as **mock (faked) locations** on Android.
- Reject only readings with **no useful location fix**, where the reported uncertainty is more than about 1 km. In that case the app asks the customer to step outside or switch on precise location, or staff add them manually.
- **One active free token per device** at a time.
- Repeated no-shows in the free lane **temporarily block that device** from joining it.
- The existing grace period and expiry rules still apply.

**What it can't stop:** a determined cheater using a GPS-spoofing app. At the price of a reservation fee, the loss is small and acceptable.

**Stronger levels, switched on per business only when there's abuse:**
1. **Rotating QR on a screen.** The business's phone or TV display (§3.8) shows a QR that changes every ~30 seconds, and joining requires the current one. It costs almost nothing extra to build.
2. **BLE strict mode** (later, optional). This is the design in `QPeer_Architecture_Updates_BLE_and_Native.md`. It needs a custom native module and an Android business phone, so build it only if real abuse justifies the work.

**Optional extra: joining from the browser.** Browsers can also read location, so a walk-in could join from a web page after scanning the QR, without installing the app. The app would still be recommended for reliable alerts, because web alerts are unreliable on iPhones. This is not part of the first version.

**Difficulty: low.** It uses a standard location API and works the same on Android and iPhone, for both customers and businesses.

### 3.3 Remote reservation

- The customer needs an account (phone OTP). They pay through Razorpay, and the server confirms the payment through a webhook.
- The Durable Object places them **in the same sequence at the moment of payment** and marks them `REMOTE`.
- **Walk-in quota:** at most X% of each hour's places can go to remote bookings. X is set per business.
- **Deposit rule:** if the customer doesn't arrive before the grace period ends, the fee is not refunded and the business gets its share. Cancelling early gets a refund under a policy set per business.
- **"Leave home by"** = estimated call time − travel time (from the map distance) − a buffer.

### 3.4 Priority Pass (rules still to be decided)

Each queue has priority classes:

```text
Triage (staff, free, unlimited)  >  Priority Pass (paid)  >  Regular (walk-in, remote, manual)
```

This builds on the priority lane in the edge-case document. Priority Pass entries get their own token series (`#V1`, `#V2`, …).

The open decision in the pitch (Option A: no limit vs Option B: limited) is **one configuration value**: the maximum number of priority passes per N regular tokens. A value of 0 means no limit. The build doesn't have to wait for the decision.

Regular customers' "people ahead" and ETA always include active priority entries, so estimates stay honest.

### 3.5 Revenue split

- Razorpay Route sends each payment's business share to the business's linked account, and QPeer keeps the rest.
- Every payment, refund and forfeited deposit is recorded in a D1 ledger. Businesses see their earnings in Business mode.

### 3.6 Analytics

- The Durable Object records **anonymous events** (join, leave, call, serve, no-show, wait duration, service interval) into **hourly buckets** in D1. It stores counts and averages, never identities.
- A daily Cron Trigger calculates trends: peak hours by weekday, weekly average wait, abandonment rate, service speed and how accurate the ETAs were.
- **Comparison with nearby businesses:** same category, nearby geohash, shown only when at least 5 businesses are in the group, so no single business can be identified.

### 3.7 Verified reviews

- When a token is served, the server issues a **signed review permit** tied to that token. Each permit can be used once and expires after 7 days.
- Walk-in customers can review without an account, because the permit proves the visit. Only the token is linked to the review.
- A business's rating = verified stars + measured wait and service averages + ETA accuracy. Rankings never use money.

### 3.8 Integrations (later)

- An **auto-advance webhook**: when a bill is closed or a patient is checked in, the business's own software tells QPeer to call the next customer.
- A **TV display mode**, opened in a browser on a cheap TV or Android TV box.
- Integrations with specific billing and clinic software, one by one, starting with whichever software the first paying customers use.

---

## 4. Build Phases

Each phase ends with a working app and a clear test. Later phases build on earlier ones.

| Phase | Builds | Test to pass (exit criteria) |
|---|---|---|
| **0. Setup** | Repo, Expo development build installed on a phone, Worker + D1 deployed | The app on a real phone talks to the deployed Worker |
| **1. Queue core** | Business creates queue, static QR, join (gate off), NEXT, skip, pause, manual add + claim code, grace period, live position, EWMA ETA with range | Backend tests (atomic numbering, Fenwick counts after leaves, grace-period alarms). Joining and serving works on two phones. |
| **2. Walk-in gate** | GPS check on join (forgiving radius check, mock-location rejection), one free token per device, no-show block, claim-code conversion | A join from a few kilometres away is rejected, and a test mock location is rejected. Someone on-site joins in under 10 s, even with poor indoor GPS. |
| **3. Map & discovery** | Business profile + pin, snapshots, map with groups and live waits, list view, filters | 50 seeded businesses load in under 1 s, and live counts update within 30 s. |
| **4. Accounts + reservations + payments** | Phone OTP, Razorpay test mode, Route split, walk-in quota, deposits, refunds, leave-by alerts | Full flow in Razorpay **test mode**: pay → join → no-show → forfeit split recorded. Cancel → refund. |
| **5. Analytics + reviews** | Event buckets, daily rollups, trend charts, nearby comparison, review permits, ratings | Simulated 30-day dataset produces correct peaks and trends. A review without a served token is rejected. |
| **6. Priority Pass** | Priority class, configurable limit, open display to waiting customers | Regular ETAs include priority entries. Limit enforced. Triage always first. |
| **7. Integrations** | Auto-advance webhook, TV display with the rotating QR option | A billing system's test call advances the queue. With rotating QR on, a 2-minute-old screenshot fails to join. |
| *Later* | BLE strict mode, browser joining for walk-ins | Only if abuse or adoption data shows a need |

The first pilot can launch after **Phase 3**, as a free queue + map with no payments. That lets you test with real clinics while payments are built.

---

## 5. Risk Ranking

| Part | Difficulty | Why |
|---|---|---|
| Payments, split, refunds | **Medium (code) / high (paperwork)** | The code is standard. Business registration, KYC and Razorpay approval are the slow parts. |
| Reliable push alerts | **Medium** | Battery savers on Indian phones. Needs a setup guide inside the app and testing on real devices. |
| Live queue correctness | **Medium** | Concurrency is handled by Durable Objects. Needs strong tests. |
| Map + discovery | **Medium-low** | Standard patterns |
| Analytics + reviews | **Low** | Database records, scheduled jobs, charts |
| Walk-in GPS check | **Low** | Standard location API. Fake-location apps can beat it, which is accepted (§3.2). |

---

## 6. What the Human Owner Must Do

The engines and Claude can't do these:

- **Create accounts:** Expo (EAS), Cloudflare, Firebase, Mapbox, Razorpay (needs a registered business + KYC), Google Play Console, Apple Developer (only if launching on iOS)
- **Test on real phones:** **two phones** (one as the business, one as the customer) for location checks, alerts and payment screens. Install each development build and report what happens.
- **Legal:** terms of service, privacy policy, refund and cancellation policy, and business registration for payments
- **Decide** the Priority Pass rules (pitch §5) and the walk-in quota and deposit defaults

---

## 7. How the Build Is Run (orchestrate)

- Claude plans each phase, writes the engine briefs, reviews the changes, runs the tests and merges.
- **agy** handles broad scaffolding and platform wiring: the Expo app, the Worker, Durable Objects and the map. **opencode** handles focused, test-heavy work: queue rules, ETA math, payments ledger, analytics rollups. After each phase, an opencode blind review checks the work.
- **Dependency installs (npm) are done by Claude before each brief,** because the engines' sandboxes block network downloads.
- **What can only be checked on real phones** (location checks, alerts, maps on a real phone, payment screens) is checked by the human owner using a short checklist provided with each development build.
