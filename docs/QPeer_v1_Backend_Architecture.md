# QPeer v1: Backend Architecture

**Status:** agreed basis for building Steps 1–5 · **Date:** 15 October 2026

This document describes **how the backend is built**: where each kind of data lives, how requests flow, how the live queue works, how payments stay correct, and the conventions every module follows. The *what* is in `QPeer_v1_Requirements_Checklist.md` (IDs like `QUE-05` refer to it); the product view is in `QPeer_v1_High_Level_Design.md`.

When code and this document disagree, fix one of them in the same change.

---

## 1. Principles

1. **One owner per piece of data.** The live state of a queue belongs to that queue's Durable Object. Everything else (businesses, users, payments, ledger, history, analytics) belongs to D1. Nothing is written in two places as a source of truth.
2. **The server decides.** Prices, quotas, order, permissions and timestamps come from the backend, never from the app.
3. **Every write that can be retried is idempotent.** Payment notifications, allocation from payments and push sends can arrive twice without double effects.
4. **Money is append-only.** The ledger is never updated or deleted, only added to.
5. **Small, testable modules.** Route handlers are thin; logic lives in services and in the Durable Object, which are tested directly against local D1 and Durable Objects.
6. **Free-plan aware.** Short CPU per request, few D1 writes per request, no long-running work in request handlers.

---

## 2. Runtime Topology

```text
                       Android app (Expo)
          HTTPS + Firebase ID token │      │ WSS (live token updates)
                                    ▼      ▼
 ┌──────────────────────────── Worker "qpeer-api" ────────────────────────────┐
 │ Hono router · middleware (request id, log, auth, errors) · zod validation  │
 │ Route modules ─► Services ─► D1 (Drizzle)                                  │
 │                         └──► QueueDO stub (RPC / WebSocket fetch)          │
 │ scheduled() ─► cron jobs (expiry, reconciliation, push receipts)           │
 └─────────────┬──────────────────────────────┬───────────────────────────────┘
               │                              │
               ▼                              ▼
   D1 (SQLite, per environment)      QueueDO (one per queue, SQLite storage)
   businesses, users, queues,        live tokens, order, timers, EWMA, sockets,
   tokens (durable record),          outbox ──► D1 writes / Expo push
   payments, ledger, snapshots,
   analytics, devices
               ▲                              │
               │                              ├──► Expo Push API ─► FCM ─► phones
   Razorpay webhooks ─► Worker               │
   Worker ─► Razorpay Orders / Refunds API   └──► (alarm) grace expiry, flushes
```

| Component | Does | Does not |
|---|---|---|
| **Worker** | Auth, validation, business/map/payment logic, routing to QueueDO, webhooks, cron | Hold live queue state, keep timers |
| **QueueDO** | Single writer of one queue's live state: numbering, order, states, wait estimate, timers, live updates, alerts | Talk to Razorpay, check user permissions (the Worker does that before calling it) |
| **D1** | Durable records, queries across queues (map, history, analytics, ledger) | Hold the live order of a queue |

---

## 3. Code Layout (`apps/api/src`)

```text
src/
├── index.ts                  Worker entry: fetch (Hono app), scheduled (cron), exports QueueDO
├── app.ts                    createApp(deps): middleware + mounts route modules
├── env.ts                    Env type helpers, config access (vars/secrets)
├── middleware/
│   ├── request-context.ts    request id, structured log line
│   ├── auth.ts               Firebase verification + user upsert (existing logic moves here)
│   └── guards.ts             requireRegistered(), requireBusinessRole(businessId, role)
├── lib/
│   ├── errors.ts             AppError + error codes, onError handler
│   ├── validate.ts           parseBody/parseQuery with shared zod schemas → 400 on failure
│   ├── time.ts               now(), ms helpers (single clock source, mockable in tests)
│   ├── ids.ts                newId() (UUID v4)
│   ├── geo.ts                bounding box, geohash (distance comes from @qpeer/shared)
│   └── hmac.ts               HMAC-SHA256 helpers (Razorpay signatures) via WebCrypto
├── db/
│   ├── schema.ts             Drizzle tables (all D1 tables)
│   └── client.ts             db(env) helper
├── modules/                  one folder per checklist module
│   ├── identity/             routes.ts, service.ts            (M1)
│   ├── business/             routes.ts, service.ts            (M2)
│   ├── queue/                routes.ts, service.ts (Worker side of M3/M4/M5)
│   ├── map/                  routes.ts, service.ts            (M7)
│   ├── payments/             routes.ts, service.ts, razorpay.ts, webhook.ts (M8)
│   ├── insights/             routes.ts, service.ts            (M9)
│   ├── notifications/        expo-push.ts, devices service    (M6)
│   └── dev/                  routes.ts (seed/simulate helpers, dev env only) (M10)
├── queue/                    the Durable Object
│   ├── queue-do.ts           class QueueDO: RPC methods, fetch (WebSocket), alarm
│   ├── storage.ts            DO SQLite schema + typed queries
│   ├── ordering.ts           sort key, people-ahead query
│   ├── eta.ts                EWMA + range (pure; math shared with packages/shared)
│   ├── scheduler.ts          single-alarm scheduler
│   ├── outbox.ts             durable outbox → D1 writes + push sends
│   └── protocol.ts           WebSocket message types
└── cron/
    └── jobs.ts               expire stale orders, reconcile payments, push receipts, close queues
```

**Rule:** route files only parse input, call one service function, and shape the response. Services hold logic and are what tests call most.

---

## 4. Conventions

| Topic | Rule |
|---|---|
| IDs | UUID v4 strings for every entity. Queue **numbers** (`#47`) are separate integers, unique per queue **session**. |
| Time | **Unix epoch milliseconds (integer)** everywhere: D1, DO storage, API JSON. Drizzle columns use `mode: "timestamp_ms"`. The app formats times for display. *(The existing `users` table stores seconds; Step 1 migrates it.)* |
| Time zone | Business hours are stored as local times with a fixed zone `Asia/Kolkata` for v1. Day boundaries (sessions, analytics days) use IST. |
| Money | Integer **paise** (`amountPaise`). Never floats. Currency is always INR in v1. |
| JSON | `camelCase` in the API, `snake_case` in SQL columns (Drizzle maps them). |
| API paths | `/v1/...`, plural nouns, actions as sub-paths (`POST /v1/queues/:id/next`). |
| Lists | Cursor pagination: `?limit=` (default 20, max 100) and `?cursor=` (opaque). Response `{ items, nextCursor }`. |
| Validation | Every request body, query and response shape is a zod schema in `packages/shared`. Handlers never trust unparsed input. |
| Coordinates | `{ lat, lng }` in decimal degrees, WGS84. |
| Locale/text | User-facing error **messages** are produced by the app from error **codes**; the API returns codes plus a short English fallback. |

---

## 5. Request Lifecycle

```text
request
 → requestContext   : requestId (x-request-id), start timer
 → auth             : public routes skip; otherwise verify Firebase ID token → upsert user → c.var.user
 → route handler    : validate input (zod) → guard (role checks) → service call
 → service          : D1 via Drizzle and/or QueueDO RPC
 → response         : zod-shaped JSON
 → onError          : AppError → its status/code; anything else → 500 "internal"
 → log line         : { ts, requestId, method, path, status, ms, userId?, code? }
```

Public routes (no token): `GET /v1/health`, `POST /v1/webhooks/razorpay`. Everything else needs a valid Firebase ID token (anonymous users included).

---

## 6. Authentication and Authorization

**Authentication** (done in Step 0): Firebase ID token, RS256, issuer/audience = Firebase project, Google keys cached. The `users` row is created on first sight and updated only when token claims change.

**Authorization levels:**

| Level | Who | Guard | Can |
|---|---|---|---|
| `anonymous` | Any signed-in user, including anonymous | (auth only) | View map and business pages, join as walk-in, manage own tokens, register a push token |
| `registered` | `isAnonymous = false` | `requireRegistered()` | Everything above + reservations, payments, payment history, create a business |
| `staff` | Member of a business with role `staff` or `owner` | `requireBusinessRole(id, "staff")` | Queue console actions for that business's queues |
| `owner` | Member with role `owner` | `requireBusinessRole(id, "owner")` | Edit business, queues, settings; view analytics and earnings |
| `dev` | Any user, only when `ENVIRONMENT !== "demo"` and not production | `requireDevEnv()` | Seed / simulate endpoints |

- Guards resolve the business from the queue when the route is queue-scoped (`queueId → businessId`), so a staff member of business A can never act on business B (no ID-guessing).
- **Ownership of tokens:** a token can only be read, left or cancelled by the user it belongs to (`tokens.user_id`), or by staff of its business.
- The QueueDO never checks permissions itself. Only the Worker calls it, after the guards pass.

---

## 7. Errors

All errors are `{ error: <code>, message?: <fallback text>, requestId, details? }`.

| HTTP | Code | When |
|---|---|---|
| 400 | `invalid_input` | zod validation failed (`details` lists fields) |
| 401 | `unauthorized` | missing/invalid token |
| 403 | `forbidden` | authenticated but not allowed (role, ownership) |
| 403 | `registration_required` | anonymous user tried a registered-only action |
| 404 | `not_found` | entity missing **or** not visible to this user (no existence leaks) |
| 409 | `conflict` | generic state conflict |
| 409 | `already_in_queue` | user already holds an active token in this queue (`details.tokenId`) |
| 409 | `device_in_queue` | another account on the same phone (device hash) holds an active free walk-in token in this queue (C2; no token id is returned) |
| 409 | `queue_closed` / `queue_paused` / `queue_full` | joins rejected by queue state |
| 409 | `quota_full` | remote reservations quota reached for this hour |
| 409 | `priority_off` / `sold_out` | Priority Pass switched off, or the daily sales cap reached (Step 4) |
| 409 | `pass_limit` | this account or this phone (device hash) already bought a pass for this queue today (Step 4) |
| 409 | `invalid_state` | action not allowed in the token's/queue's current state |
| 422 | `too_far` / `mock_location` / `no_location_fix` | walk-in location check failed |
| 423 | `free_lane_blocked` | too many recent no-shows |
| 429 | `rate_limited` | too many requests |
| 502 | `payment_provider_error` | Razorpay call failed |
| 500 | `internal` | anything unexpected (logged with requestId) |

`AppError(status, code, message?, details?)` is thrown from services; `onError` maps it. Unknown errors never leak messages to clients.

---

## 8. Data Model (D1)

Columns are listed in logical order; every table also has `created_at` / `updated_at` unless noted. **Step** = the build step that adds the table.

| Table | Key columns | Indexes / constraints | Step |
|---|---|---|---|
| `users` | id, firebase_uid, is_anonymous, phone, email, display_name, free_lane_blocked_until | unique(firebase_uid) | 0 (migrate to ms in 1) |
| `businesses` | id, owner_user_id, name, category, address, phone, lat (nullable until pinned), lng, geohash, hours_json, status (`active`/`inactive`, owner toggle), public_stats (owner opt-in, Step 3), first_listed_at (set once, Step 3) | idx(status, lat, lng), idx(owner_user_id) | 1 |
| `business_members` | business_id, user_id, role (`owner`/`staff`) | pk(business_id, user_id), idx(user_id) | 1 |
| `queues` | id, business_id, name, status (`active`/`archived`), settings_json, settings_version | idx(business_id) | 1 |
| `queue_snapshots` | queue_id (pk), business_id, lat, lng, is_open, is_paused, waiting, eta_low_ms, eta_high_ms, now_serving, in_service (fix batch), updated_at | idx(lat, lng) | 2 |
| `tokens` | id, queue_id, session_id, business_id, user_id (null for triage), number, series (`R`/`P`/`T`), class, method (`walkin`/`remote`/`staff`), state, joined_at, called_at, served_at, ended_at, end_reason, payment_id, rev, device_hash (C2), expires_at (C4) | idx(user_id, state), idx(queue_id, session_id), unique(queue_id, session_id, series, number) | 2 |
| `devices` | user_id, expo_push_token, platform, device_hash (C2, optional), last_seen_at | pk(expo_push_token), idx(user_id) | 2 |
| `push_tickets` | id (Expo ticket id), token_id, expo_push_token, kind, sent_at, receipt_checked_at, status | idx(receipt_checked_at) | 2 |
| `free_lane_strikes` | id (outbox id), user_id, token_id, device_hash (C2), at (one row per no-show) | idx(user_id, at), idx(device_hash, at) | 2 |
| `outbox_receipts` | id (QueueDO outbox id), kind, applied_at — dedupe for additive analytics upserts | pk(id) | 2 |
| `payments` | id, user_id, queue_id, business_id, token_id, kind (`reservation`/`priority`/`upgrade`), amount_paise, device_hash (priority and upgrade, 2026-10-18), razorpay_order_id, razorpay_payment_id, status, refund_id, refund_paise (partial refunds), reason (`duplicate_payment` / `amount_mismatch` mark a stray row, §10.6), refund_attempts, refund_retry_at (refund backoff and lease, migration 0007), expires_at | unique(razorpay_order_id), unique(razorpay_payment_id), idx(user_id), idx(status, expires_at), idx(queue_id, device_hash, created_at) | 4 |
| `ledger_entries` | id, payment_id, business_id, kind (`capture`/`refund`/`forfeit`/`business_share`/`platform_share`), amount_paise, at | idx(business_id, at), idx(payment_id) — **append-only** | 4 |
| `webhook_events` | id (Razorpay event id), type, received_at, processed_at | pk(id) — dedupe | 4 |
| `analytics_hourly` | queue_id, business_id, hour_start (IST hour, epoch ms), joins, leaves, served, no_shows, cancels, sum_wait_ms, waits, sum_interval_ms, intervals, eta_hits, eta_total | pk(queue_id, hour_start), idx(business_id, hour_start) | 2 (written), 5 (read) |
| `ratings` *(x)* | id, token_id, business_id, queue_id, user_id, lane (`regular`/`priority`), experience_stars (0–5), service_stars (0–5), created_at. Replaces the older `reviews` (stars + text) row, superseded 2026-10-18. | unique(token_id), idx(business_id, created_at) | 6 |

**Settings JSON** (`queues.settings_json`, validated by a shared zod schema with defaults): `joinRadiusM` 150, `walkinQuotaPct` 50, `reservationFeePaise` 2000, Priority Pass (2026-10-18, all business-set, no platform limits): `priorityEnabled` false, `priorityFeePaise` 10000 (pass and upgrade price), `priorityPerRegular` N (whole number ≥ 1; the form prefills 2 when switched on; replaces the old "0 = off"), `priorityDailyCap` null (no cap), `priorityValidityMin` 0 (= today; else hours to days), `priorityCancelRefundPct` 50, `upgradeMinSavingMin` 5; `businessSharePct` 70, `graceMinutes` 10, missed-turn rejoin (R1, decided 2026-10-18): `rejoinDelayMin` 15 (penalty in minutes of service, turned into people at rejoin time, §9.4), `lateWindowMin` 15 (null = no limit; "I'm here" after the window → end of the line); `cancelWindowMin` 15, `counters` 1, `maxSize` 300, `serviceMinutesHint` 5, `triageDailyCap` 5, `paidPerUserCap` 2 (retired 2026-10-30, INC-065: still accepted and stored, never read; one active ticket per person per queue applies to paid reservations), `ticketValidityMin` 0 (C4: 0 = until the queue closes; else 1 h … 7 days from joining, presets 1 h, 2 h, 4 h, 8 h, 1 day, 2 days, 7 days in the app; max 10 080). Changing settings increments `settings_version`; the QueueDO receives the new settings and applies them to **new** tokens only (a token's `expires_at` is fixed at join).

**Step 4 data (2026-10-18):** token state `BOOKED`, `tokens.checked_in_at` (check-in or upgrade time), `tokens.session_id` empty while BOOKED (the pass gets its session and P number at check-in), `payments.device_hash`, `payments.refund_paise`.

**Migration 0005 (fix batch):** `tokens.device_hash`, `tokens.expires_at`, `free_lane_strikes.device_hash` (+ index), `devices.device_hash`, `queue_snapshots.in_service`. All nullable or defaulted, so the old Worker keeps working against the migrated D1 (migrate first, then deploy).

**Listed on the map** is derived, not stored: `status = active` AND the business has a pin AND at least one non-archived queue (BIZ-07). Responses include `listed: boolean` and, for owners, `missingForListing: ("pin" | "queue")[]`.

**Business hours** (`hours_json`): `{ mon: [{ from: "09:00", to: "13:00" }, ...], ... }` — multiple ranges per day, empty array = closed.

**Migrations:** Drizzle `drizzle-kit generate` → SQL files in `drizzle/migrations` → `wrangler d1 migrations apply DB --env <env> --remote`. Migrations are forward-only; dev data can be wiped before the demo.

---

## 9. The Live Queue: QueueDO

One Durable Object per queue, addressed by `idFromName(queueId)`. All operations on a queue are serialized through it, which is what makes numbering atomic without locks.

### 9.1 Sessions

A **session** is one open→close cycle (normally one day). Opening a queue starts a session (`sessionId`), numbers restart at 1, and closing ends it (remaining tokens expire, paid ones are refunded). Analytics and history keep the `sessionId`.

**Auto-close (B20, INC-047).** An open (or paused) session closes by itself at `autoCloseAt(hours, openedAt)` (shared `hours.ts`): 30 min after the end of the **last** hours range of the IST day the session opened; if it opened after that (or on a closed day), at 23:59 IST of that day; never sooner than 30 min after opening. The DO keeps the business hours in `meta.hours` (sent by the Worker on open/queue create, on every hours edit, and by the 15-min cron) and closes on its own alarm; the cron (`modules/queue/auto-close.ts`, ≤ 40 open queues per run, stalest snapshot first) hands each open queue its hours and closes overdue sessions — the safety net for DOs that never got the hours (sessions opened before this code). The console shows a warning from 15 min before (`ConsoleState.autoCloseAt`); each **Keep open** (`POST /v1/queues/:id/keep-open`, staff) sets `keep_open_until = max(autoCloseAt, now) + 1 h`. Auto-close runs exactly the manual close (`closeCore`), including the C4 carry-over. Paid tokens it ends get `payment` outbox items (D1 `refund_due` / `forfeited`); the 15-min `refunds` cron makes the Razorpay refunds (Step 4).

**Ticket validity and carry-over (C4).** With `ticketValidityMin > 0` a token gets `expires_at = joinedAt + validity`. The alarm ends WAITING tokens whose validity ran out as `EXPIRED` / `validity` (also while the queue is closed). On close (manual or auto) a WAITING token with `expires_at > now` is **not** ended: it is marked `carried`, keeps its number, its old `sessionId` and its sort key, and stays WAITING in the DO (and in D1) while the queue is closed. Because sort keys only grow, carried tokens are at the front of their class when the next session opens, in their original order; triage still goes first. New tokens of the new session start at #1 (no clash: the D1 unique key includes the session). The console and ticket show a "Kept" marker; a carried token's overnight wait is not counted as a wait/ETA sample. CALLED and GRACE tokens end on close as before. Until-close tickets (`ticketValidityMin = 0`, the default) behave exactly as before.

**Priority holders at close (C6, decided 2026-10-18).** Checked-in priority tokens never carry over, even with a multi-day pass window: on close (manual, auto, or while paused) they end and get a full refund. BOOKED passes are not part of any session; they stay BOOKED until checked in or until their window ends (then `EXPIRED` / `validity`, no refund). The credit counter resets to 0 when a session opens.

### 9.2 DO storage (its own SQLite)

| Table | Contents |
|---|---|
| `meta` | key/value: queueId, businessId, sessionId, status (`closed`/`open`/`paused`), nextNumber per series, nowServing, lastServed, settings JSON + version, EWMA mean/variance, lastCallAt, pausedSince, pausedTotalMs, lastNextUndo, hours (B20), keepOpenUntil (B20), priorityCredits (Step 4) |
| `tokens` | id, number, series, class, method, userId, state, sortKey, joinedAt, calledAt, counter, graceUntil, paymentOrderId, alertFlags, deviceHash (C2), expiresAt (C4), carried (C4) — schema v2 adds the last three with `ALTER`s; Step 4 adds checkedInAt, the `BOOKED` and `MISSED` states, missedAt and the `rejoined` flag |

**Now serving** (coordinator report 2026-10-16, INC-048): the CALLED token called last; when nobody is at a counter, the last token SERVED this session (`lastServed`); null when closed. It is recomputed after every change, so a called token that leaves, is skipped, misses its turn or is undone stops showing at once. Snapshot, token views and console all read the same value.
| `intervals` | recent Next-to-Next intervals (last ~50) for the median used in outlier capping |
| `outbox` | id, kind (`d1_write` / `push`), payload JSON, attempts, nextAttemptAt |
| `hourly` | counters for the current IST hour (flushed through the outbox) |

### 9.3 Token states

```text
BOOKED (Priority Pass, paid) ─check-in (GPS)─► WAITING (priority lane, P number)
   ├─cancel before check-in─► CANCELLED (refund at priorityCancelRefundPct)
   └─window ends───────────► EXPIRED (end reason `validity`, no refund)

WAITING ─next─► CALLED ─served─► SERVED
   │              └─no-show─► GRACE ─admit─► CALLED (front)  ─served─► SERVED
   │                              └─timer─► MISSED ─"I'm here" (once)─► WAITING (within lateWindowMin: behind
   │                                           │                          ceil(rejoinDelayMin ÷ avgServiceMin) ≥ 1;
   │                                           │                          after it: end of the line)
   │                                           └─close / business limit─► EXPIRED (+ strike if free walk-in; never carried over, R4)
   │            (a rejoined ticket that misses again: GRACE ─timer─► EXPIRED, + strike if free walk-in)
   ├─upgrade (paid)► WAITING (same token, priority lane at the upgrade time)
   ├─leave───────► LEFT
   ├─cancel──────► CANCELLED (refund decided by the Worker)
   ├─validity ran out (C4) ► EXPIRED (end reason `validity`)
   └─queue closed► EXPIRED   (unless still valid: carried over, stays WAITING; never for checked-in priority, C6)
```

Terminal: `SERVED`, `EXPIRED`, `LEFT`, `CANCELLED`. A token is **active** while `BOOKED`, `WAITING`, `CALLED`, `GRACE` or `MISSED`.

**MISSED and rejoin (decided 2026-10-18, Step 4; HLD §5.2 has the full rules and edge cases).** Same for walk-ins and remote joiners.
- No-show → GRACE with the existing `grace_started` alert (no new alert at grace start). Admit during GRACE → served right after the current person.
- GRACE timer → `MISSED`, not `EXPIRED` (`missedAt = now`). A MISSED token is out of the live order and is not counted as waiting. One `missed` push is sent (R3, §11). During GRACE the ticket shows a large server-corrected countdown "Come now — m:ss left" (the token view carries `graceUntil`).
- "I'm here" = `POST /v1/tokens/:id/rejoin { lat, lng, accuracy, mocked }` → the same GPS walk-in check as joining (location never stored; mocked rejected, R4) → DO `rejoin(tokenId, userId)` → `WAITING`. Position (R1, decided 2026-10-18): if `now − missedAt ≤ lateWindowMin` (or `lateWindowMin` is null), behind K WAITING tokens with K = max(1, ceil(`rejoinDelayMin` ÷ avgServiceMin)), where avgServiceMin is the queue's EWMA interval (cold start: `serviceMinutesHint`); fewer than K waiting → the end. After the window → the end of the line. K is taken at the moment of the rejoin. **Once per ticket** (a `rejoined` flag on the token). Simultaneous rejoins are ordered by the server receive time of a successful check (the DO serializes them).
- A missed priority or triage holder rejoins inside their own class range (the skip class rule, G1; R4). MISSED tokens never carry over at close, even with a multi-day `ticketValidityMin`: they expire at close (R4).
- Second miss (a rejoined token's GRACE ends), or no rejoin by queue close (or the business limit) → `EXPIRED`. Free walk-ins also get one no-show strike (existing rule: 3 in 30 days block free joins for 7 days, per user and per device hash). Paid tokens (remote, priority) get no strike: losing the fee is the penalty (C5, 2026-10-18).
- Only the owner's rejoin moves a token back. Staff never reposition it.
- Paid tokens: forfeit only when the token expires and the person never arrived. Served (even after a rejoin) = the fee paid for holding the place. Business cancel or early close → refund. Priority money rules: §10.5.
- Replaces the dropped idea "NEXT calls only checked-in people". Check-in is used only for rejoin after MISSED and for Priority Pass activation.

**BOOKED, check-in and upgrade (decided 2026-10-18, Step 4; HLD §5.2).**
- A pass is created only by `confirmPayment` (verify or webhook), never from the client alone. DO `book(...)` → `BOOKED`, no number, no session, not in the live order, not counted as waiting.
- Check-in = `POST /v1/tokens/:id/checkin { lat, lng, accuracy, mocked }` → the walk-in GPS check within `joinRadiusM` (mocked rejected, location never stored; a counter-QR photo alone is not enough) → DO `checkIn(tokenId, userId)` → `WAITING` in the priority lane, `checkedInAt = now`, next P number of the current session, signed ticket re-issued. Allowed only while the queue is open and the pass window is valid. After check-in the window no longer applies.
- Upgrade = `POST /v1/tokens/:id/upgrade` → Razorpay order → `confirmPayment` → DO `upgrade(tokenId)`: the same token moves into the priority lane at the upgrade time. Only from `WAITING`; if the token is no longer WAITING when the payment confirms → automatic full refund.
- One active token per user per queue (BOOKED counts). Buying a pass while holding a WAITING token is an upgrade, never a second token.

### 9.4 Order and "people ahead"

`sortKey = classRank * 1e15 + sequence * 1024`, where `classRank` is 0 for triage, 1 for priority, 2 for regular, and `sequence` increases per allocation (for remote reservations: at payment confirmation). The gaps of 1024 let a skip take a key between two neighbours; when a gap is used up, the waiting list is renumbered (`ordering.ts`).
- **People ahead** = `COUNT(*) WHERE state = 'WAITING' AND sortKey < mine`, using an index on `(state, sortKey)`. This is exact after leaves, cancels and skips, and fast for thousands of tokens, so the Fenwick tree from the early design isn't needed.
- **Priority limit** (superseded 2026-10-18 by the lane + credit rule below): a priority token's sequence was pushed back so that at most 1 priority entry is served per `priorityPerRegular` regular tokens.
- **Priority lane (decided 2026-10-18, Step 4).** Priority tokens are numbered in their own series (P1, P2…, `series = 'P'`). Their `sequence` is taken at check-in (or upgrade), so the lane is ordered by check-in time, not purchase time. Whether an upgraded token keeps its R number or takes a P number is an engine detail to settle in Step 4.
- **Next rule (credit counter).** `next` picks: triage head; else the priority-lane head if `priorityCredits ≥ N`; else the regular head; else (no regulars) the priority head. Each regular call does `credits = min(credits + 1, N)`; a priority call does `credits −= N` (never below 0). Triage calls change nothing. A regular call that ends as No-show still counts. `undoNext` restores the credit value from before the call. Credits start at 0 when a session opens (C1). Staff cannot call a chosen priority person; only `next` decides.
- **People ahead with the priority lane on.** For a priority token: triage ahead + priority tokens ahead in the lane + the regular calls still needed before each of those is due. For a regular token: a range (C3). Low = regulars ahead + triage + the priority calls that the credit rule will make for holders **already checked in**. High = as if every N-th call goes to priority (regulars ahead × (1 + 1/N), rounded up). Shared function in `packages/shared`, used by the DO, the purchase preview ("priority ~X · regular ~Y · save ~Z") and the upgrade offer (hidden below `upgradeMinSavingMin`). The load-test people-ahead invariant (§19.1) must use the same rule (Step 4 work).
- **Skip** (decided 2026-10-18, replaces "after the next N waiting tokens, N = 3") gives the token a new sequence behind K = max(1, ceil(`rejoinDelayMin` ÷ avgServiceMin)) WAITING tokens of its own class range, or the end if fewer wait. Same K and same avgServiceMin as the R1 rejoin (EWMA Next interval; configured service time at cold start). K is fixed at the moment of the skip. The class rule (G1) stays.
- **Rejoin after MISSED** (R1, decided 2026-10-18) uses the same key mechanics and the same K as Skip: behind K WAITING tokens within the late window, else the end of the line (§9.3). Example: 3 min per person → behind 5; 30 min per person → behind 1. MISSED tokens are excluded from people ahead. When a called token becomes No-show or MISSED, nobody else's people-ahead changes. On a rejoin, only tokens behind the insert point get +1.

### 9.5 RPC interface (called only by the Worker)

| Method | Effect | Notes |
|---|---|---|
| `init(queueId, businessId, settings)` | Store identity + settings | Idempotent |
| `updateSettings(settings, version)` | New settings for new tokens | Ignores older versions |
| `open()` / `close()` | Start/end a session | `close` returns paid tokens to refund |
| `pause()` / `resume()` | Pause state, paused time excluded from ETA | |
| `allocate({ method, userId, cls, paymentOrderId?, deviceHash? })` | New token at the end of its class | Checks: open, not full, one active free token per user, a paid reservation only when the user has no active ticket here (`already_in_queue` + `tokenId`, INC-065; `paidPerUserCap` retired), **one active free walk-in per device hash (C2, `device_in_queue`)**, walk-in quota for `remote`. **Idempotent by `paymentOrderId`.** |
| `setHours(hours)` · `keepOpen()` · `autoCloseCheck(hours)` | B20 auto-close: store hours; push the auto-close 1 h later; cron safety net | `keepOpen` fails `invalid_state` when closed or hours unknown |
| `checkQuota(userId)` | Can a remote reservation be made right now? | Used before creating a Razorpay order: open, not full, no active ticket of the user here (any active state incl. BOOKED/MISSED → `already_in_queue` + `tokenId`), remote quota |
| `next(counter)` / `undoNext()` | Call the next token; undo within 30 s | Records interval. Step 4: picks by the credit rule (§9.4); undo restores the credits. |
| `book({ userId, paymentOrderId, deviceHash, validUntil })` | New Priority Pass in `BOOKED` (Step 4) | Only from `confirmPayment`. Checks: priority on, daily cap, one active token per user. **Idempotent by `paymentOrderId`.** |
| `checkIn(tokenId, userId)` | `BOOKED` → `WAITING` in the priority lane (Step 4) | Worker runs the GPS check first. Fails `invalid_state` if closed or the window ended. |
| `upgrade(tokenId, paymentOrderId)` | `WAITING` regular → priority lane at upgrade time (Step 4) | Idempotent by `paymentOrderId`; fails `invalid_state` if not WAITING (→ refund). |
| `skip(tokenId)` / `noShow(tokenId)` / `admit(tokenId)` / `served(tokenId)` | Staff actions | |
| `rejoin(tokenId, userId)` | "I'm here" after MISSED (Step 4) | Worker runs the GPS check first. Once per ticket; fails `invalid_state` otherwise. |
| `leave(tokenId, userId)` / `cancel(tokenId, userId)` | Customer actions | `cancel` returns whether a refund applies (inside cancel window) |
| `insertTriage()` | Free staff-only triage token | Daily cap |
| `getToken(tokenId)` / `getState()` | Read live state | Used by token screen and console |
| `fetch(request)` | WebSocket upgrade for live updates | Hibernation API |

Every mutating method updates the token row, recalculates the wait estimate, enqueues outbox items, broadcasts to sockets and reschedules the alarm **within the same call**.

### 9.6 Wait estimate

- Each `next` records `interval = now − lastCallAt − pausedDuring`. Values are capped at 5× the median of the last 50 intervals.
- `ewma = α·interval + (1−α)·ewma` (α = 0.3), with matching exponentially weighted variance.
- **Cold start:** before 3 intervals exist, `ewma = serviceMinutesHint` from settings.
- For a token with `k = peopleAhead + 1`: `expectedCall = lastCallAt + k·ewma` (minus elapsed time of the current interval); range = `k·ewma ± 1.28·σ·√k`, low clamped to "now".
- **With the priority lane on (C3, 2026-10-18):** `k` is a range (§9.4); the low end of the wait uses the low `k`, the high end the high `k`. Regulars also see "Priority lane on · 1 in N".
- **Be-back-by** = expected call − 5 min buffer. **Leave-home-by** = expected call − (straight-line distance ÷ 20 km/h) − 10 min buffer.
- The math lives in `packages/shared` (pure functions) so the app can display consistent values; the DO is the source of the numbers it sends.
- ETA accuracy for analytics: when a token is called, record whether the call time fell inside the range shown at join.
- **One wait text everywhere (B19, INC-046/049).** Every surface (map pill, card, list, business page, join screen, console; the ticket for its own range) formats the DO's range with the shared `live-text.ts`: the midpoint as "~N min". A summary's durations are measured at its `updatedAt`, so `waitRangeAt` subtracts the snapshot's age (the DO's estimate falls linearly between changes): a 30 s old snapshot and the live summary give the same text. With 0 waiting: "No wait" when nobody is at a counter, "Next in ~N min" when someone is (`inService`, now in `QueueLiveSummary`, `MapQueue` and `queue_snapshots.in_service`).

### 9.7 Single-alarm scheduler

A DO has one alarm. The scheduler computes the earliest of:
- the next grace expiry,
- the next snapshot flush (only while the queue changed since the last flush; at most every 30 s),
- the next outbox retry,
- the next "head back now" alert time for any token,
- the hourly analytics flush (top of the IST hour),
- the next ticket validity end (C4),
- the auto-close time of the open session (B20),

and calls `setAlarm(earliest)`. `alarm()` handles everything due, then reschedules. Alarms survive DO restarts.

### 9.8 Outbox (DO → D1 and push)

The DO never writes to D1 or sends pushes inline in a way that could be lost. Instead it writes an **outbox row in its own storage in the same operation** as the state change, then drains the outbox immediately (best effort) and again on the alarm (retry with backoff: 5 s, 30 s, 2 min, 10 min, then every 30 min).

Two drains, each chained (never two at once of the same kind):
- **Rows** (`token_upsert` + `snapshot`): ≤ 50 items per **D1 batch**, each batch bounded by an 8 s timeout (idempotent, so a late success plus a retry is harmless). A mutating RPC waits for this drain — at most 5 s — so the caller's D1 token row normally exists when the response arrives (the Worker's `GET /v1/tokens/:id` reads D1 first).
- **Side** (`push`, `analytics`, `strike`): runs in the background (`ctx.waitUntil`) after the row drain queued before it, so tickets and strikes always find their token row. Pushes per round (≤ 25) go together: one device lookup, one Expo call, one ticket write. The alarm and `flushOutbox()` (tests, load-test reset) await both.

Before an inline drain the alarm is set no earlier than the first backoff (5 s) for the new items — a safety net in case the drain dies, not a second drain racing it. RPCs and drains slower than 1 s log their phase timings (`queue-do.slow-rpc` / `queue-do.slow-drain`: op, queue id, ms, counts — no user data); the Worker logs slow joins as `queue.join.slow` (D1 / checkJoin / allocate ms).

| Outbox kind | Target | Idempotency |
|---|---|---|
| `token_upsert` | D1 `tokens` | upsert by token id, guarded by a per-token `rev` that only goes up (never move backwards) |
| `snapshot` | D1 `queue_snapshots` | upsert by queue id with `updated_at` guard |
| `analytics` | D1 `analytics_hourly` | additive upsert keyed by (queue_id, hour_start); each outbox item applied once (outbox id inserted into `outbox_receipts` in the same batch) |
| `strike` | D1 `free_lane_strikes` | insert with outbox id as row id |
| `forfeit` / `refund_request` | Worker payments service (via D1 `payments` status + cron pickup) | payment status transitions are idempotent |
| `push` | Expo Push API | dedupe by (token id, alert kind) flag set before sending |

### 9.9 Live updates (WebSocket protocol)

- The app opens `wss://…/v1/queues/:queueId/live?tokenId=…` (or `?console=1` for staff) with `Authorization: Bearer <Firebase ID token>` on the upgrade request — never a token in the URL (§23). The Worker authorizes, then forwards the upgrade to the DO.
- Hibernation API: `ctx.acceptWebSocket(ws, ["t:<tokenId>" | "console"])`; the attachment stores `{ kind, tokenId }`.
- Server → client messages (`protocol.ts`, `LiveMessage` zod union in shared):
  - `{ type: "token", token: TokenView }` — personal state: number, state, peopleAhead, nowServing, etaLow/High, beBackBy, counter (leaveHomeBy is computed by the app)
  - `{ type: "queue", console: ConsoleState }` — full state for staff consoles
  - `{ type: "pong" }` — reply to the client's `{"type":"ping"}` heartbeat (every 30 s), sent by the Hibernation auto-response
- Clients reconnect with backoff and always refetch `GET /v1/tokens/:id` after reconnecting (TOK-02, TOK-03). The socket is a fast path, never the only path.
- **Ordering:** every `TokenView` carries `rev`, the token's own revision (the same counter that guards D1 upserts; it goes up on every change of that token, never down). Socket messages, HTTP answers and refetches can arrive out of order, so the app keeps the view with the highest `rev` (`newerTokenView` in shared; equal rev → the incoming view, which has a fresher position/ETA). A left or ended ticket therefore never flips back to WAITING.
- Fan-out: on each change, sockets for tokens within the first ~20 positions get an update immediately; others at most every 30 s (they don't need every Next).

---

## 10. Payments (Razorpay, test mode)

### 10.1 Payment states

```text
created ──(captured, verified)──► captured ──► allocated
   │                                  │            ├──► refunded   (cancel in window, queue closed)
   │                                  │            └──► forfeited  (no-show expired)
   │                                  └──(allocation impossible)──► refunded (quota race)
   ├──(failed)──► failed
   └──(30 min unpaid)──► expired
```

### 10.2 Flow

1. **Create order** `POST /v1/queues/:id/orders { kind }` — `requireRegistered`; DO `checkQuota`; amount from queue settings; create Razorpay order (receipt = our payment id); insert `payments` row `created` with `expires_at` = now + 30 min. For `kind: priority` (and `POST /v1/tokens/:id/upgrade`, kind `upgrade`) the body carries `deviceHash`; the Worker checks priority on, not sold out, 1 pass per account **and** per device hash per queue per IST day (`pass_limit`), and stores `device_hash` on the payment (§10.5).
2. **App pays** with Razorpay Checkout using the order id.
3. **Client confirmation** `POST /v1/payments/verify { orderId, paymentId, signature }` — verify `HMAC_SHA256(orderId|paymentId, keySecret)`; then `confirmPayment(orderId, paymentId)`. The signature alone is not money: `confirmPayment` fetches the payment from Razorpay; not captured (and not capturable) → `409 invalid_state` with `details.paymentStatus`, nothing recorded.
4. **Webhook** `POST /v1/webhooks/razorpay` — verify `X-Razorpay-Signature` = `HMAC_SHA256(rawBody, webhookSecret)` **on the raw body before parsing**; dedupe by event id in `webhook_events`; `payment.captured` / `order.paid` / `payment.authorized` → `confirmPayment(...)` with the signed payment entity; `refund.processed` → mark refund done; `refund.failed` → back to `refund_due` (§10.6). An unknown order is logged and answered 200.
5. **`confirmPayment`** (shared by 3, 4, the 15-min recovery and the daily reconcile; idempotent): only a Razorpay `captured` payment counts; an `authorized` one of the order's amount is captured first (Capture API). The order's first captured payment becomes its payment: D1 status → `captured`; DO `allocate(... paymentOrderId)` (priority: `book`, upgrade: `upgrade`); on success → `allocated` + token id; on `quota_full`/`queue_closed`/… → refund via API → `refunded`. Ledger rows are written in one D1 batch with the status change. Any other captured payment on the order, or one of the wrong amount, is a stray (§10.6), refunded in full.
6. **Cancel** (`TOK-05`/`PAY-07`): DO `cancel` says whether the window applies → Refunds API → `refunded`.
7. **Forfeit**: DO expiry of a paid token → outbox → payment `forfeited` + ledger `forfeit`, `business_share`, `platform_share`.
8. **Queue closed**: DO `close` returns paid active tokens → refunds.

### 10.3 Ledger rules

- **Capture:** `capture +amount`, `business_share +amount×pct`, `platform_share +rest` (rounded so the shares add up exactly).
- **Refund:** `refund −amount`, plus negative `business_share` and `platform_share` entries reversing the capture split.
- **Forfeit:** a `forfeit` marker entry (amount 0); the capture split stands — the business keeps its share.
- Business earnings = sum of its `business_share` entries in the period.
- Never update or delete ledger rows. Corrections are new rows.

### 10.4 Reconciliation (cron, daily)

- Payments `captured` for more than 10 minutes without a token → retry `confirmPayment`, else refund and flag.
- Payments `created` past `expires_at` → `expired`.
- Fetch Razorpay payments for the last day (test mode) and compare with D1: every captured or authorized payment that is not its order's recorded payment goes through `confirmPayment` (missed capture → ticket or refund; second payment or wrong amount → stray refund); log mismatches.
- **Every 15 min** (`recover_orders`, G3): captured payments without a ticket for 2+ min are confirmed again; our orders still `created` / `failed` / `expired` from the last 2 h (≤ 15 per run, the one checked longest ago first) are looked up with `GET /orders/:id/payments` and any paid attempt is confirmed. So a lost webhook plus a dead phone costs ≤ 15 min, not a day.
- **Call budget** (INC-064): every scheduled run shares one budget of 40 outbound calls (each Razorpay call and each `refund_issued` push), see §14. Recovery, refunds and the daily scan stop cleanly when it is used up and the next run continues; an order lookup that did not happen is not rotated, so it is asked first next time. In the daily run the provider scan comes before reconcile's own due-refunds step.

### 10.5 Priority Pass and upgrade money rules (decided 2026-10-18, Step 4)

| Case | Payment | Ledger |
|---|---|---|
| Served | `allocated` stays; fee kept | capture split stands (demo 70/30) |
| Customer cancels a BOOKED pass | `refunded` (partial) at `priorityCancelRefundPct` (default 50) via the Refunds API, `refund_paise` set | `refund −refund_paise` + reversing shares in proportion |
| Never checked in by the end of the window | `forfeited` | `forfeit` marker |
| Checked in, missed, never rejoined | `forfeited` (no no-show strike, C5) | `forfeit` marker |
| Checked in, queue closed before serving (also closed while paused, C6) | `refunded` (full), automatic | full refund entries |
| Business cancels or closes early | `refunded` (full), automatic | full refund entries |
| Upgrade confirmed after the token left WAITING | `refunded` (full), automatic | full refund entries |

- Checked-in priority tokens never carry over; `close` returns them for a full refund (C6).
- **Anti-misuse:** the pass is tied to the buyer's account (no transfer). `payments.device_hash` is recorded for `priority` and `upgrade`, and the 1-pass-per-queue-per-day rule is checked per user and per device hash. This extends the C2 device-hash rule, which so far ignored paid flows. Every call is logged with its time (audit for staff favouritism).

### 10.6 Payment edge cases (review of 2026-10-29)

A **stray** is a captured Razorpay payment that buys nothing: a second captured payment on an order already paid by another one, or a payment of the wrong amount. It gets its own `payments` row (`id = stray_<razorpay payment id>`, the order's kind, its real amount, `reason` `duplicate_payment` or `amount_mismatch`, `razorpay_order_id = <order id>:<payment id>` so the order's own row stays unique), a capture split and a full refund that reverses it. It nets to zero in the ledger and shows in both payment histories. Refunds hold a 2-min lease on `refund_retry_at` (no two refunds at once); after a failure the same column holds the backoff (next 15-min run, then 15 min, 30 min, 1 h … 6 h) and `refund_attempts` counts failures; from the 3rd failure on each one logs `refund_stuck` (error, alert on it). A live refund with our receipt is reused; a refund is capped at the captured amount minus Razorpay's other live refunds of the payment.

Tests are in `apps/api/test/payments-edge.test.ts` (names quoted in short).

| Situation | Behaviour | Test |
|---|---|---|
| Verify of an `authorized` payment (auto-capture off) | Captured via the Capture API, then the ticket | "verify of an authorized payment …" |
| Verify with a valid signature, payment failed at Razorpay | `409 invalid_state` (`details.paymentStatus`), nothing recorded | "verify with a valid signature of a failed payment …" |
| Razorpay unreachable at verify | `502 payment_provider_error`, nothing recorded; a retry works | "verify while Razorpay is unreachable …" |
| Webhook `payment.authorized` | Captured and confirmed; the later `payment.captured` is a no-op | "webhook payment.authorized …" |
| Authorized for a wrong amount | Never captured (Razorpay releases the hold), error log | "authorized for an amount other than the order's …" |
| Two captured payments on one order (UPI retry) | One ticket; the other is a `duplicate_payment` stray, refunded in full | "UPI retry: two captured payments …" |
| The duplicate seen again (verify, webhook, reconcile) | One refund only; its verify answers with the order's ticket | "the duplicate seen again …" |
| Two payments confirmed at the same time | One ticket, one capture set, one refund | "two captured payments confirmed at the same time …" |
| Verify and webhook of one payment at the same time | One ticket, one capture ledger set | "concurrent verify + webhook …" |
| Webhook lost and no verify (phone died) | 15-min `recover_orders` confirms it | "webhook lost and the app never verified …" |
| Authorized payment found by the 15-min run | Captured, then the ticket | "an authorized payment found by the 15-min run …" |
| Order expired, payment captured late | Confirmed (ticket, or full refund if impossible) by webhook or the 15-min run | "order expired …" (2 tests), "a late capture whose ticket can no longer be made …" |
| Order older than 2 h | Left to the daily reconcile, which confirms it | "orders older than 2 h …" |
| Webhook for an order not in D1 | Logged, `200` (no retry storm); confirmed by the 15-min run once the row exists | "webhook for an order we don't know …" |
| DO made the ticket, D1 `allocated` update failed | Payment stays `captured`; the next run/verify completes it, same ticket | "DO made the ticket but the D1 status update failed …" |
| Captured amount ≠ order amount | `amount_mismatch` stray, actual amount refunded in full, error log; the order stays unpaid | "captured amount ≠ order amount …" |
| Order asked again, its payment captured but unconfirmed | Confirmed now; `409 already_in_queue` with `details.tokenId` | "order requested again while its payment is captured …" |
| Captured payment stuck without ticket, order asked again | Finished now; `409 already_in_queue` | "a captured payment stuck without its ticket …" |
| Unpaid order asked again | Same order returned (no paid attempt at Razorpay) | "an unpaid order …" |
| Pass already booked / upgrade already paid | `409 already_in_queue` with the ticket id | "Priority Pass already booked …", "Skip ahead already paid …" |
| `payment.failed`, then a retry succeeds on the same order | One ticket | "payment.failed, then a retry succeeds …" |
| `refund.failed` | Back to `refund_due`; the 15-min run makes a new refund; one live refund | "refund.failed → back to refund_due …" |
| Webhook replay, same event id | No effect | "webhook replay with the same event id …" |
| Refunds keep failing | Backoff; no attempt before it ends; `refund_stuck` after 3 failures | "refunds keep failing …" |
| Two refund attempts at once | One Razorpay refund | "two refund attempts at the same time …" |
| Refund larger than captured, or after a manual refund | Capped at what is left | "a refund asked for more than captured …" |
| Partial % refund of an odd fee | Whole paise; refund and reversed shares add up exactly | "partial % refund of an odd fee …" |
| Logs | Ids and codes only: no signature, body, token or secret | "verify, webhook and refund logs …" |

**One active ticket per person per queue, paid reservations included** (owner, 2026-10-18; enforced for reservations 2026-10-30, INC-065). A reservation order when the user already has any active ticket in the queue (BOOKED, WAITING, CALLED, GRACE or MISSED) → `409 already_in_queue` with `details.tokenId` (the app opens that ticket). If such a ticket appears between the order and the payment, `confirmPayment` gets `already_in_queue` from the DO and refunds the payment in full (reason `already_in_queue`). `paidPerUserCap` is retired: the settings schema still accepts and stores it, nothing reads it. A free walk-in while holding a paid reservation is still allowed (§23, "Walk-in while holding a pass").

| Situation | Behaviour | Test |
|---|---|---|
| Reservation already allocated (app lost the answer), Pay again | `409 already_in_queue` + `tokenId`, no new Razorpay order | "reservation already allocated by the webhook …" |
| Free ticket or booked pass, then a reservation order | `409 already_in_queue` + that ticket's id | "a free ticket or a booked Priority Pass also blocks …" |
| Active ticket made after the reservation order, then paid | Refunded in full, reason `already_in_queue`; the other ticket untouched | "an active ticket made after the order was created …" |

Partial refunds are whole paise: the outbox's `refund_paise = CAST((amount_paise × pct) / 100 AS INTEGER)` (D1 binds the percentage as a REAL; before 2026-10-29 a 33 % refund of ₹99.99 stored 3299.67, INC-062).

---

## 11. Notifications

- `devices` holds Expo push tokens per user (upsert on app start and on token change; removed on sign-out) — ALR-02.
- Sending: the DO outbox calls the Expo Push API (`https://exp.host/--/api/v2/push/send`) in batches of up to 100, stores ticket ids in `push_tickets`; an hourly cron checks receipts and deletes `DeviceNotRegistered` tokens.
- Alert kinds (ALR-03): `head_back`, `next`, `called`, `grace_started`, `refund_issued`, `queue_paused`, `queue_closed`. Each is sent at most once per token (flag set in the DO before sending). `grace_started` ("you were called, come now") is also the alert for the missed-turn flow; there is no new alert at grace start.
- `missed` (R3, decided 2026-10-18, Step 4): sent once when a token becomes MISSED: "You missed your turn. Tap I'm here when you arrive."
- Android channel `queue-alerts` (high importance) is created by the app; the payload names it.

---

## 12. Map and Discovery

- `GET /v1/map?minLat&minLng&maxLat&maxLng[&category][&openNow=1][&limit]` (any signed-in user) → **one** D1 statement (`modules/map/service.ts`): a CTE picks listed businesses (status `active`, has pin, ≥ 1 active queue) inside the box through `idx(status, lat, lng)`, nearest to the box centre first, `limit + 1` rows; the outer select joins their active queues and `queue_snapshots`. `limit` defaults to 200 (max 300); `truncated: true` tells the app to zoom in. Each box side may be at most 1.5° (else 400 `invalid_input`). `openNow` is evaluated in SQL with **the same rule as the badge** (B16, INC-043): some active queue's snapshot is open and not paused, whatever the hours; so the limit applies after the filter. `isOpenNow` in responses still reports the hours (information only); the app shows "Open (after usual hours)" when a queue is open outside them (shared `openLook`). `GET /v1/queues/:id` adds `business.isOpenNow` and `business.todayHours` for the join screen. Response `MapResponse { items: MapBusiness[], truncated, serverTime }`; no user-specific data. The request log records the path only, never the box.
- Business detail `GET /v1/businesses/:id` → profile + queues with snapshots + `isOpenNow` + `todayHours` + `stats` (MAP-05: `servedCount`, `avgWaitMs` = Σwait/waits, `avgServiceMs` = Σinterval/intervals, `etaAccuracyPct` = eta_hits/eta_total, over the last 28 days of `analytics_hourly`; each average null below 20 samples). **MAP-06 visibility:** members always get `stats`; non-members get it once the business has been listed for 14 days (`businesses.first_listed_at`) or when the owner set `publicStats` (`PATCH /v1/businesses/:id { publicStats }`), otherwise `stats: null`.
- `GET /v1/queues/:id` exposes `joinRadiusM` to everyone (the only public queue setting). Step 4 adds the public Priority Pass fields: `priority: { enabled, perRegular, feePaise, soldOut }` for the "Priority lane on · 1 in N" label.
- **Ratings (decided 2026-10-18, Step 6 extra).** `POST /v1/tokens/:id/rating { experience: 0–5, service: 0–5 }` (owner of a `SERVED` token, once per token: `unique(token_id)`; the row stores the ticket's lane). Map items, the business card and `GET /v1/businesses/:id` carry `rating`, split by lane (RT1, decided 2026-10-18): `{ regular: { experienceAvg, serviceAvg, count }, priority: { … } }`. A lane's averages are null until it has at least 5 ratings (RT2). Stars only, no text. The business cannot delete ratings; it can reply in public (RT2; the reply fields on the row are a Step 6 detail) — §23.
- Snapshots are at most ~30 s old (MAP-02); the app polls the visible area every 30 s while the map is visible.
- Geohash is stored for later (clustering on the server, larger areas); v1 uses the bounding box only.
- Dev only: `POST /v1/dev/seed-map` / `POST /v1/dev/unseed-map` (registered user; 404 unless `ENVIRONMENT` is `local` or `dev`) create/delete 8 "Demo · " businesses (11 queues) around Jammu, owned by the fixed user `seed-map-owner`, ids prefixed `5eed0000-` (queues `5eed0001-`). Seeding is idempotent, opens every queue and tops each up to a few triage tokens so the map shows waiting counts.

---

## 13. Analytics

- The DO counts joins, leaves, served, no-shows, cancels, waits, intervals and ETA hits per IST hour in its `hourly` table, and flushes to `analytics_hourly` through the outbox at the end of each hour and on queue close.
- Insights (`/v1/businesses/:id/analytics?range=7d|28d`) are computed **on read** with SQL aggregates over `analytics_hourly` — no rollup tables in v1.
- No customer identities in analytics tables.

---

## 14. Scheduled Jobs (`scheduled()`)

| Schedule | Job |
|---|---|
| every 15 min (`*/15 * * * *`) | `auto_close` (B20): hand open queues their hours, close overdue sessions (safety net for the DO alarm, §9.1); `expire_orders`: unpaid orders past 30 min → `expired`; `recover_orders` (G3, §10.4): confirm paid orders of the last 2 h whose webhook was lost (≤ 15 per run) and captured payments without a ticket; `refunds`: make the Razorpay refunds of `refund_due` payments whose backoff is over (≤ 40 per run) |
| hourly | check Expo push receipts; prune dead push tokens |
| daily 03:00 IST (`30 21 * * *`) | `reconcile` (§10.4): expire orders, retry captured-without-token, compare Razorpay's captured payments of the last day, due refunds, flag paid tokens without a payment; delete `webhook_events` older than 30 days |

Each env registers only the quarter-hour trigger; it also runs the hourly jobs at minute 0 and the daily jobs at 21:30 UTC, in the same invocation (INC-056).

**Call budget per run (INC-064).** The Workers free plan allows 50 external subrequests per invocation, cron runs included (D1 and Durable Object bindings don't count). `runScheduled` gives one run one `CallBudget` of `CRON_CALL_BUDGET` = **40**, shared by all its jobs: every Razorpay call counts (`withBudget`), and so does the `refund_issued` push of a refund (skipped when nothing is left). The other 10 are headroom for the hourly push-receipt call and later additions. Order: `recover_orders` (paid, no ticket) → `refunds` → `reconcile`. At 21:30 UTC the quarter-hour jobs may spend at most 40 − `RECONCILE_RESERVE` (15) = 25, so the daily provider scan always gets its calls. A job stops before a call it can't pay for (a refund needs 2 left, an order lookup 1); a call the budget refuses throws `BudgetSpent`, which is never a provider failure (no refund attempt counted, no backoff, no error log; a refund lease is given back). Job results carry `deferred` (left for the next run), and the run logs one `info` line `call_budget_used_up` with `limit`, `used` and `deferred` per job, only when something was deferred. HTTP requests carry no budget. Tests: `apps/api/test/payments-budget.test.ts`.

Cron handlers are thin and call the same services as the API, so they are tested the same way.

---

## 15. Rate Limiting

- Queue-level limits are enforced by the DO itself (one active free token per user per queue, no paid reservation next to another active ticket, max size, triage cap).
- Endpoint-level limits (join, order, verify) use a simple per-user fixed window counter. v1 implementation: the Workers Rate Limiting binding if available on the plan, otherwise a small D1 counter table keyed by `(user_id, action, window)`. **Step 2 decision: deferred** (NFR-11, `TODO(NFR-11)` at the join route); only the DO's queue-level caps exist so far.
- OTP and sign-in abuse are handled by Firebase.

---

## 16. Observability

- One JSON log line per request (`ts, requestId, method, path, status, ms, userId, code`), plus `level: "error"` lines from `onError`, the DO (with `queueId`) and cron jobs.
- **Never log:** Firebase tokens, Razorpay secrets or signatures, raw webhook bodies, exact walk-in coordinates (log only the distance and accuracy).
- `wrangler tail --env dev` for live logs. Every error response carries `requestId`, which the app shows (PLT-09).

---

## 17. Configuration and Secrets

| Name | Kind | Where |
|---|---|---|
| `ENVIRONMENT` | var | `local` / `dev` / `demo` |
| `FIREBASE_PROJECT_ID` | var | `qpeer-f6dbe` |
| `RAZORPAY_KEY_ID` | **secret** | test key id; returned to the app in order responses, never bundled (Step 4 decision: all three Razorpay values are secrets) |
| `RAZORPAY_KEY_SECRET` | **secret** | `wrangler secret put` per env; `.dev.vars` locally |
| `RAZORPAY_WEBHOOK_SECRET` | **secret** | same |
| `EXPO_ACCESS_TOKEN` | **secret** (optional) | only if Expo push security is enabled |
| `LOADTEST_JWKS` | **secret** (`loadtest` env only) | public JWK set of the load-test signing key; ignored unless `ENVIRONMENT` is exactly `loadtest` |
| `TICKET_SIGNING_KEY` | **secret** (optional, per env) | C3: Ed25519 private JWK with `kid` (`npm run ticket-keys:gen` → gitignored `secrets/ticket-signing-key.json`). Without it nothing is signed (`signedTicket: null`, empty `/v1/ticket-keys`); a broken value logs `ticket-sign` errors and also disables signing — joins never fail because of it. Never logged. |
| `TICKET_PUBLIC_KEYS` | var (optional) | C3 rotation: extra public JWK set still served by `/v1/ticket-keys` |
| `DB` | D1 binding | per env |
| `QUEUE` | DO binding | per env |

`.dev.vars.example` lists every name. Config is read through `env.ts` and validated with zod at first use; a missing value is a 500 `internal` with a clear log line (as done for `FIREBASE_PROJECT_ID`).

---

## 18. Environments and Deployment

| Env | Worker | D1 | Purpose |
|---|---|---|---|
| `local` | `wrangler dev` / tests | local SQLite | development, tests |
| `dev` | `qpeer-api-dev` | `qpeer-dev` | phone testing, webhooks, seeding |
| `demo` | `qpeer-api` | `qpeer-demo` | the demo (Step 5) |
| `loadtest` | `qpeer-api-loadtest` | `qpeer-loadtest` | simulated-user load & correctness runs (Step 3.5, §19.1) |

Deploy order for a change touching both: **migrate D1 first, then deploy the Worker** (new code may read new columns; old code ignores them). DO storage changes are applied lazily inside the DO (`CREATE TABLE IF NOT EXISTS` / versioned `ALTER`s in `storage.ts`, keyed by a schema version in `meta`).

---

## 19. Testing

| Layer | How |
|---|---|
| Pure logic (ETA, ordering, fee split, geo, hours) | Vitest unit tests in `packages/shared` and `src/queue/*` |
| Services + routes | Vitest + Workers pool: real local D1 and DOs, migrations applied in setup, signed test tokens (local RS256 key) |
| QueueDO | Call RPC methods directly through stubs; control time with an injectable clock; run alarms with the test helpers |
| Concurrency | `Promise.all` of parallel joins/payments → assert unique numbers, one allocation per order |
| Payments | Razorpay HTTP calls behind an interface; tests use a fake that records calls; signature tests with known vectors |
| Contract | Every response in tests is parsed with its shared zod schema |

Every requirement ID that has backend behaviour gets at least one test named after it (`it("QUE-03: people ahead excludes left tokens", …)`), so coverage can be traced back to the checklist.

### 19.1 Load test (Step 3.5)

A separate `loadtest` Worker + D1 is driven by a Node simulator (`scripts/loadtest/`, Node 24 type stripping, no dependencies) with hundreds of virtual users. It never touches `dev`/`demo`, creates no Firebase users and sends no real pushes.

- **Test-only auth** (`middleware/loadtest-auth.ts`): only when `ENVIRONMENT === "loadtest"` **and** the `LOADTEST_JWKS` secret is set, a token whose issuer is `qpeer-loadtest` is verified against that JWK set (RS256, issuer/audience `qpeer-loadtest`, `exp`/`iat`/`sub` required; Firebase-shaped claims `sub`, `firebase.sign_in_provider`, `phone_number`). Every other token, and every token in every other environment, goes to the Firebase verifier, so a load-test token is 401 there even if the secret were set by mistake. Firebase tokens keep working on the loadtest Worker. A JWK set holding a private key is a config error (500).
- **Recording push sender** (`expo-push.ts` `loadtestTransport`): in `loadtest`, sends never call Expo; each message gets an ok ticket `loadtest-<uuid>`, so `push_tickets` holds one row per send (token, kind). Receipts are always ok.
- **Helper routes** `GET /v1/loadtest/stats` (push counts per token+kind, analytics rows, snapshots, per-queue DO status/waiting/outbox backlog), `GET /v1/loadtest/queues/:id/audit` (DO `auditTokens()` dump + D1 token rows), `POST /v1/loadtest/reset` (closes every queue, then — once every DO outbox is empty — wipes the D1 tables; 409 while draining). All 404 unless `ENVIRONMENT=loadtest` **and** the caller was verified by the load-test key. ≤ 40 queues per request (subrequest limit).
- **Simulator**: refuses any base URL but `https://qpeer-api-loadtest.qpeer-api.workers.dev` (or `--local` wrangler dev) and checks `/v1/health` says `loadtest`. Owners create businesses around Jammu with 2 queues (grace 1 min), customers (anonymous + some phone-registered, most with a fake push device) join in a burst and spread out, with a few too-far / mocked / no-fix / double-join probes; 40 % hold a WebSocket, the rest poll; some leave. Staff loops per queue: Next every 5–40 s (scaled for short runs), skip, no-show → admit, served, undo, triage, pause/resume. Map clients poll `/v1/map`. Every request takes one unit of a hard budget (default 15 000; the load phase stops early to leave room for the checks).
- **Invariant checker** (after a 35 s quiet period, then again after closing every queue and draining): D1 tokens == DO tokens; numbers unique and gap-free per session+series; snapshot == DO; `/v1/map` summary == Σ queues == DO; people-ahead exact (DO rank and sampled `GET /tokens/:id`); WebSocket clients converge (a mismatch is re-checked against a fresh audit after 3 s, twice, because grace expiries keep changing the DO after the load stops); queue order (triage first, untouched regulars FIFO, console positions 1..n); people-ahead never rises without a skip/triage/undo; terminal states never move back except Undo; analytics totals == simulator log and final states; pushes deduplicated and every called token alerted once; rejection codes; no unexpected responses; no join coordinates in a `wrangler tail` capture (`--tail-log`). Reports go to `scripts/loadtest/reports/<timestamp>.md|.json`.
- **Step 4 work (2026-10-18):** with the priority lane on, "people-ahead exact" and the queue-order check must follow the credit rule and the C3 range (§9.4), using the same shared function as the DO.

---

## 20. API Catalogue (v1)

`A` = any signed-in user (anonymous OK), `R` = registered, `S` = staff of the business, `O` = owner, `P` = public, `D` = dev env only.

| Module | Method + path | Auth | Purpose (checklist) |
|---|---|---|---|
| Platform | `GET /v1/health` | P | PLT-02 |
| Platform | `GET /v1/ticket-keys` (public JWK set, `Cache-Control: max-age=3600`) | P | C3 offline ticket check |
| Identity | `GET /v1/me` · `PATCH /v1/me` (displayName) | A | IDN-06 |
| Identity | `POST /v1/me/devices` · `DELETE /v1/me/devices/:pushToken` | A | ALR-02 |
| Business | `POST /v1/businesses` · `GET /v1/me/businesses` | R | BIZ-01, BIZ-09, BIZ-15 |
| Business | `GET /v1/businesses/:id` | A | public detail + `isOpenNow`, `todayHours`, `stats` (MAP-05/06); members get extra fields |
| Business | `PATCH /v1/businesses/:id` (profile, pin, hours, `publicStats`) | O | BIZ-02, BIZ-04, BIZ-05, MAP-06 |
| Business | `POST /v1/businesses/:id/deactivate` · `/activate` | O | BIZ-08 |
| Queues | `POST /v1/businesses/:id/queues` · `PATCH /v1/queues/:id` (name, settings) · `POST /v1/queues/:id/archive` | O | BIZ-10–12 |
| Queues | `GET /v1/queues/:id` (public info + live summary + `joinRadiusM`) | A | JON-03 |
| Console | `POST /v1/queues/:id/{open,close,pause,resume,next,undo-next,triage,keep-open}` | S | BIZ-13, QUE-05–12, B20 |
| Console | `POST /v1/queues/:id/tokens/:tid/{skip,no-show,admit,served}` | S | QUE-06, QUE-08 |
| Console | `GET /v1/queues/:id/console` (full live state) | S | console screen |
| Join | `POST /v1/queues/:id/join` `{ lat, lng, accuracyM, mocked, deviceHash? }` → `TokenView` with `signedTicket` | A | JON-04–07, C2, C3 |
| Tokens | `GET /v1/me/tokens?status=active\|recent` | A | TOK-06 |
| Tokens | `GET /v1/tokens/:id` · `POST /v1/tokens/:id/leave` · `POST /v1/tokens/:id/cancel` | A (owner of token) | TOK-01, TOK-05 |
| Tokens | `POST /v1/tokens/:id/rejoin` · `POST /v1/tokens/:id/checkin` `{ lat, lng, accuracy, mocked }` | A (owner of token) | QUE-23, PRI-03 (Step 4) |
| Tokens | `POST /v1/tokens/:id/upgrade` `{ deviceHash }` → Razorpay order | R (owner of token) | PRI-05 (Step 4) |
| Tokens | `POST /v1/tokens/:id/rating` `{ experience, service }` | A (owner of a served token) | RAT-01 (Step 6) |
| Live | `GET /v1/queues/:id/live` (WebSocket) | A | TOK-02 |
| Map | `GET /v1/map?minLat&minLng&maxLat&maxLng[&category][&openNow=1][&limit]` | A | MAP-01–04, NFR-04 |
| Payments | `POST /v1/queues/:id/orders` `{ kind: reservation\|priority, deviceHash? }` · `POST /v1/payments/verify` · `GET /v1/me/payments` | R | PAY-01–05, PAY-11, PRI-02 |
| Payments | `GET /v1/businesses/:id/payments` (net shares from the ledger) | O | PAY-11 (business side) |
| Payments | `POST /v1/webhooks/razorpay` | P (signature) | PAY-04, PAY-07 |
| Priority | `GET /v1/queues/:id/priority-preview` | A | PRI-02 honest preview |
| Console | `POST /v1/queues/:id/rejoin-for-customer` `{ label, checkCode } \| { signedTicket }` | S | QUE-29 (R2) |
| Loadtest | `POST /v1/loadtest/queues/:id/priority-pass` (book + check in without Razorpay) | loadtest key only | §19.1 |
| Insights | `GET /v1/businesses/:id/analytics?range=` · `GET /v1/businesses/:id/earnings?range=` | O | INS-01–08 |
| Dev | `POST /v1/dev/seed` · `POST /v1/dev/simulate` · `GET /v1/dev/queue-ping/:id` | D | DEM-01–06 |
| Dev | `POST /v1/dev/seed-map` · `POST /v1/dev/unseed-map` (registered) | D | map testing before Step 5 |

Every request/response pair has a named zod schema in `packages/shared` (e.g. `CreateBusinessBody`, `BusinessDetail`, `TokenView`, `MapResponse`).

---

## 21. Free-Plan Limits and How We Stay Inside Them

Check current numbers on Cloudflare's pricing pages; these are the constraints that shape the design:

| Limit (free plan) | Design response |
|---|---|
| Short CPU time per request (milliseconds) | No heavy work in requests; Firebase keys cached; analytics computed with SQL, not JS loops |
| Daily request limit | App polls the map every 30 s only while visible; live updates use WebSockets (hibernating) |
| D1 rows written per day | User upsert writes only on change; snapshots throttled to 30 s; analytics hourly, not per event |
| Durable Object requests/duration | Hibernating sockets; one alarm per queue; batched fan-out |

---

## 22. Decisions Log

| Decision | Why |
|---|---|
| Epoch milliseconds everywhere | One unit across D1, DO, API and app; no time-zone parsing bugs |
| Plain fetch + shared zod schemas instead of Hono RPC client | Keeps Cloudflare types out of the mobile build |
| SQL `COUNT` instead of a Fenwick tree | DO SQLite with an index is exact and fast enough; less code to get wrong |
| Outbox in the DO for D1 writes and pushes | A crash or D1 hiccup can't lose a token record, analytics or an alert |
| Sessions per open→close cycle | Numbers restart daily; history and analytics stay clean |
| `confirmPayment` shared by client verify and webhook | Whichever arrives first wins; the other is a no-op |
| Ledger append-only with split entries | Earnings and reconciliation are simple sums |
| Fixed time zone `Asia/Kolkata` in v1 | Demo city is Jammu; multi-zone support later |

## 23. Open Questions (decide in the step named)

| Question | Step |
|---|---|
| Razorpay Route availability in test mode (split in ledger only if not) | 4 |
| Priority Pass rules — decided by the owner 2026-10-18 (below), built in Step 4. | done |
| R2 staff "Rejoin for customer" with a ticket check code — decided by the owner 2026-10-18 (below), built in Step 4. | done |

### Decided in Step 2

| Question | Decision |
|---|---|
| WebSocket auth | The client sends `Authorization: Bearer <Firebase ID token>` on the upgrade request (React Native's WebSocket supports headers). Tokens are never accepted in the URL. The Worker authorises (token owner, or staff with `?console=1`) and forwards only the upgrade to the DO. |
| Rate limiting | Only the queue-level caps in the DO for now (one active free token per user per queue, max size, one active ticket per person for paid reservations (was a paid cap, INC-065), triage cap). Endpoint limits (NFR-11) are deferred; `TODO(NFR-11)` marks the join route. |
| Skip semantics | The skipped token is re-sequenced behind the next **3** waiting tokens, or to the end if fewer remain. A skipped CALLED token re-enters behind the first 3 waiting. *Superseded 2026-10-18: Skip uses the rejoin delay (§9.4, "Skip uses the rejoin delay" below).* |
| Heartbeat | Client sends `{"type":"ping"}` every 30 s; the DO's Hibernation auto-response answers `{"type":"pong"}` without waking the object (no server pings, no alarm wake-ups). |
| Console live message | `{ type: "queue", console: ConsoleState }` (full state) instead of only status/nowServing/waiting, so the console never refetches after a push. |
| D1 token upsert guard | A per-token `rev` that only goes up (instead of a state order), because admit (GRACE → CALLED) and undo move states "backwards" legitimately. |
| Snapshot wait range | `queue_snapshots.eta_low_ms/eta_high_ms` and `QueueLiveSummary.waitLowMs/waitHighMs` are **durations** for a new joiner (absolute times would go stale in an idle snapshot). |
| Staff joining their own queue | Allowed: owners/staff may walk-in join as customers (one phone plays both roles in device tests; staff of small businesses queue too). |
| Free-lane block | 3 no-shows (grace expiry of a free walk-in) within 30 days → `users.free_lane_blocked_until` = last strike + 7 days. |

### Decided in Step 3

| Question | Decision |
|---|---|
| "Listed for 14 days" (MAP-06) | `businesses.first_listed_at`, set the first time the BIZ-07 rule holds (pin set, queue created, activation) and never cleared, so a short deactivation doesn't restart the clock. Existing businesses were backfilled with their first active queue's `created_at`. |
| Stats thresholds | Each average needs ≥ 20 samples (waits, intervals, ETA checks); `servedCount` is always returned. |
| Map ordering under the limit | Nearest to the box centre first (equirectangular distance), so a truncated result keeps the middle of the view. |
| Dev environments | Dev routes answer only when `ENVIRONMENT` is `local` or `dev` (was "not demo"). |

### Decided in Step 3.5

| Question | Decision |
|---|---|
| How to load-test without many phones | A separate `loadtest` Worker + `qpeer-loadtest` D1 and a Node simulator (§19.1); `dev`/`demo` data is never touched. |
| Auth for virtual users | A locally generated RS256 key; its public JWK set is the `LOADTEST_JWKS` secret of the loadtest env only. The verifier is chosen by issuer, and only when `ENVIRONMENT === "loadtest"` and the secret exists — everywhere else the code path is unreachable (tests cover `local`/`dev`/`demo`/unknown). No Firebase users are created. |
| Pushes under load | Recorded, never sent: fake ok tickets `loadtest-<uuid>` in `push_tickets`, counted per (token, kind) by `/v1/loadtest/stats`. |
| Request budget | Hard cap per run (default 15 000, max 50 000) counted client-side, because the free plan allows ≈ 100k Worker requests a day. |
| Reset | Close every queue, wait until every DO outbox is empty, then wipe the D1 tables — otherwise a late outbox write would re-create rows after the wipe. |
| Loadtest helper reach | 404 unless the environment is `loadtest` **and** the caller's token was verified by the load-test key (a Firebase user on that Worker can't call them). |
| Outbox drain cost (findings F1/F2) | Batched per round (§9.8): rows in one D1 batch, pushes in one send. Per-item round trips made a burst of 25 joins wait ~3 s for one shared serial drain, and a close/pause with ~100 tokens took 5–13 s. Round 2 (G2): pushes/analytics/strikes moved off the RPC path into a background drain; RPCs wait only for their D1 rows, bounded at 5 s (one ~20 s join per full run had already created its token, so the stall was after allocation, in the shared drain). |
| Out-of-order token views (H1) | `TokenView.rev` + "keep the highest rev" in the app, instead of reading GET from the DO only (it already does) or making every RPC wait longer: a socket message sent just before a leave can still arrive after the leave's answer, and only a version on the view fixes that for every path (socket, leave/join answer, refetch). |
| Load-test client network (H2) | Requests that never got a connection after the client's retries are reported as "client network" and fail the run only above 1 % of requests. Timeouts, 5xx, broken connections on non-idempotent calls and bad bodies still fail "No unexpected responses". A staff action with a lost answer (not `connect`) counts as "may have happened" for the order/monotonic/undo/push checks. |
| Skip across classes (G1) | A skip only moves a token back. A skipped triage token may go behind lower classes ("behind the next 3 people"; since 2026-10-18 behind K people, §9.4); a skipped regular/priority token never lands inside a higher class's range (it goes to the head of its own class at most), so later triage arrivals still go ahead of it. |
| `canceled` alarm events | Benign: an alarm the platform had started to dispatch was overridden by a later `setAlarm`/`deleteAlarm` before our handler ran (CPU 0). The alarm is re-derived from durable storage on every reschedule and every handler step is atomic + idempotent, so nothing is lost or applied twice. Fewer of them now that inline drains don't arm a 250 ms alarm. |
| Simulator timeouts | Connection failures (Node fetch gives up connecting after 10 s) are retried in the client and reported separately; a lost join answer is retried once and `409 already_in_queue` (with `details.tokenId`) is accepted as the token, like the app's "open ticket". Whole-request timeouts (20 s) still fail the run. |

### Decided in the fix batch (2026-10-16, branch `feat/fix-batch-rebuild`)

| Question | Decision |
|---|---|
| "Open" (B16, INC-043) | The queue state decides whether a customer can join; hours are information. Labels from shared `openLook`: "Open now", "Open (after usual hours)", "Paused", "Queue not open" (closed inside hours), "Closed now". `openNow=1` = some queue open and not paused (same as the badge). |
| Auto-close (B20, INC-047) | 30 min after the day's last hours range; opened outside hours (or on a closed day) → 23:59 IST of the opening day (a business working off-hours keeps the evening and taps Keep open past midnight); never sooner than 30 min after opening. DO alarm closes on time; the 15-min cron is the safety net. Keep open = +1 h per tap from the current auto-close time (`meta.keep_open_until`, reset on open/close). Owner can't switch auto-close off in v1. |
| Wait text (B19, INC-046/049) | One helper (`waitText`/`waitSummary`): "No wait", "Next in ~N min", "N waiting · ~N min"; the midpoint of the DO's range, aged by the snapshot's `updatedAt`. The ticket formats its own range the same way. |
| Now serving (INC-048) | Called token called last, else the last served this session, else none. A token that left/was skipped/missed its turn while called never shows. |
| Device hash (C2, INC-042) | SHA-256(ANDROID_ID + fixed public salt `qpeer-device-v1:`), computed on the phone (`@noble/hashes`); only the hash travels and is stored (D1 tokens/strikes/devices, DO tokens). Second free walk-in on the same phone in the same queue: same account → `already_in_queue` + tokenId; other account → `device_in_queue` (no token id: it belongs to someone else). 3 no-shows per device hash in 30 days block free joins (read at join, 7 days after the last). Missing hash = old rules. Paid/remote/staff flows ignore it (superseded 2026-10-18 for Priority Pass purchases and upgrades: the hash is recorded and limited there, §10.5). |
| Signed ticket (C3) | Ed25519 (Workers WebCrypto `Ed25519` works in workerd and the test pool; ES256 not needed). Text `QPT1.<b64url payload>.<b64url sig>` (~370 chars): `{v, q, t, n, s, c, sid, iat = joinedAt, exp = expiresAt ?? joinedAt + 24 h, kid}`; deterministic, so GET returns the same ticket. Signed on join and `GET /v1/tokens/:id` for active tokens only, never on socket messages (the app keeps it). Verified on the phone with `@noble/curves` (bundled public keys + cached `/v1/ticket-keys`); the console's "Verify a ticket" also reads the live status when online. No key → no ticket, nothing breaks. |
| Ticket validity + carry-over (C4) | `ticketValidityMin` (0 = until close). Carried tokens keep number, session id and place — no reissue (the customer's number and signed ticket stay valid), "Kept" marker in console and ticket. Expired-by-time → `EXPIRED` / `validity` via the alarm, also while closed. Carried waits are not wait/ETA samples. Carry-over needs no new numbering rule because sort keys only grow. |
| App storage (C1) | `@react-native-async-storage/async-storage` 2.2.0 (SQLite on Android, no config plugin, async API fast enough for a preload at start) over `expo-sqlite/kv-store` (sync reads, but a bigger native library for a few small keys). One `lib/storage.ts`: typed keys with zod schemas and a version per key; anything unreadable reads as missing. Saved: ticket views (+ signed ticket, ended ones for 24 h, ≤ 30), battery-tip dismissal, console queue, map filters/sort/view, last camera (not the user's position), ticket public keys. |
| Offline (B13, INC-040) | Degrade, never block: one slim strip ("Offline — showing saved info", Retry); last views stay; server actions disabled with "You're offline. This needs internet." (`Button needsNetwork`); ticket shows "Last updated N min ago"; map shows "The map needs internet" with the saved active tickets; console greyed "Offline — actions paused". Offline detection stays request-based (no NetInfo). |

### Decided 2026-10-18 (owner): missed turn and late arrival (A, built in Step 4)

| Question | Decision |
|---|---|
| Called, not present | Staff tap No-show → GRACE (`graceMinutes`) with the existing `grace_started` alert. Staff keep calling others; nobody is blocked. |
| Arrives during GRACE | Admit → served right after the current person (no place lost). |
| GRACE ends | New state `MISSED` (not `EXPIRED`), out of the live order. Ticket text: "You missed your turn. When you're here, tap I'm here to rejoin." |
| "I'm here" | `POST /v1/tokens/:id/rejoin` with the same GPS walk-in check as joining (location never stored) → WAITING, placed by the R1 rule below (first written as "behind the next 3, the Skip rule"; revised 2026-10-18). Once per ticket. Simultaneous rejoins ordered by the server receive time of a successful check. |
| Second miss / no rejoin | A rejoined ticket that misses again, or a MISSED ticket not rejoined by queue close (or the business limit) → `EXPIRED` + one no-show strike for free walk-ins only (existing rule: 3 in 30 days block free joins for 7 days, per user and per device hash). The strike is now taken at this expiry, no longer at the end of GRACE. Paid tickets get no strike (C5, 2026-10-18). |
| Who moves a ticket | Only its owner, by rejoining. Staff never reposition it. |
| People ahead | No change for others when a called ticket becomes No-show or MISSED. On a rejoin, only tokens behind the insert point get +1. |
| Remote fee | Kept only if the ticket expires and the person never arrived. Served (even after a rejoin) = the fee paid for holding the place. Refunded if the business cancels or closes early. |
| "NEXT calls only checked-in people" | Dropped (presence tracking is unreliable). Check-in is used only for rejoin after MISSED and for Priority Pass activation. |
| Misuse and edge cases | Owner's table in HLD §5.2 (late on purpose, repeat misses, reinstall, many queues, "I'm here" from home, wrong No-show, too few waiting, simultaneous rejoins, dead phone, didn't hear the call). |

### Decided 2026-10-18 (owner): missed-turn refinements R1, R3, R4 (built in Step 4)

| Question | Decision |
|---|---|
| R1 Rejoin position (revised, decided) | Two business settings; the penalty is minutes of service, not people. `rejoinDelayMin` (default 15): the engine turns it into people with the queue's own service-time estimate (EWMA interval; `serviceMinutesHint` at cold start): behind K = max(1, ceil(rejoinDelayMin ÷ avgServiceMin)) WAITING tokens, or the end if fewer wait. Example: clinic 3 min/person → behind 5; salon 30 min/person → behind 1. `lateWindowMin` (default 15; the business can raise it or set null = no limit): "I'm here" within the window after MISSED → the K rule; after the window → the end of the line. Replaces the fixed "behind 3" of A4. Skip uses the same K (row below). |
| Skip uses the rejoin delay (decided 2026-10-18) | A staff Skip moves the token behind the same K = max(1, ceil(`rejoinDelayMin` ÷ avgServiceMin)) WAITING tokens of its own class range, or the end if fewer wait. Same avgServiceMin as R1. K is fixed at the moment of the skip. The class rule (G1) stays: a skipped regular/priority token never lands inside a higher class's range; a skipped triage token may go behind lower classes. Replaces the Step 2 "behind the next 3". |
| R3 Missed alert + grace countdown | One push when a ticket becomes MISSED: kind `missed`, "You missed your turn. Tap I'm here when you arrive." The ticket screen in GRACE shows a large live countdown "Come now — m:ss left" on the server-corrected clock (the Step 2 grace card, made prominent). |
| R4 Engine details | MISSED tickets never carry over at close, even with multi-day `ticketValidityMin` (they expire at close). A missed priority/triage holder rejoins within their own class range (the skip class rule, G1). "I'm here" rejects mocked locations like join. Analytics count served-after-rejoin as served and misses as no-shows, and leave away time out of wait statistics. |

### Decided 2026-10-18 (owner): staff-assisted rejoin R2 (built in Step 4)

| Question | Decision |
|---|---|
| R2 Staff-assisted rejoin (dead phone) | Every ticket gets a 4-character **check code** at allocation, shown under its number, for example "#14 · K7P2". Unambiguous alphabet (no 0/O, 1/I/L). Stored on the token (DO + D1) and included in the signed ticket. After MISSED, staff "Rejoin for customer" needs the ticket number + check code, or a valid signed-QR scan when the phone works. Same once-only rule and same position rule as R1. If the person knows neither, staff serve them as a new walk-in (later: Add person). Staff still never reposition by choice. |

### Decided 2026-10-18 (owner): Priority Pass "flexible pass" and upgrade (B, built in Step 4)

Replaces the "Proposed 2026-10-18 … Priority Pass (B)" table of the same day (default N = 3, `ticketValidityMin` window, GPS-or-counter-QR check-in, partial refund "still open") and "VIP: pay to skip". Both superseded 2026-10-18. HLD §5.2 has the customer-facing text.

| Question | Decision |
|---|---|
| Model | No time slots. A paid pass for one queue that enters the line when the holder arrives. Per-business setting, OFF by default. |
| Buy | Signed-in, non-anonymous only. Price and validity window set by the business (default "today"; hours to days). Honest preview before paying: "Priority holders wait about X min · regular wait about Y min · you save about Z min". Token created only after server-side confirmation (verify + webhook); no confirmation → no token. |
| BOOKED | New state: paid, not in the line, holder anywhere (§9.3). |
| Check-in | GPS within `joinRadiusM` (the walk-in check; a counter-QR photo alone is not enough; mocked rejected) → WAITING in the priority lane, ordered by check-in time. After check-in the window no longer applies; the holder stays until served or the queue closes. |
| Numbers | Own series P1, P2… (§9.4). |
| Missed turn | Same rules as everyone: Grace → Missed → one rejoin → Expired. |
| Upgrade (v1, main revenue path) | A WAITING ticket shows "Skip ahead for ₹X, about N min faster". Paying moves the same ticket into the priority lane at the upgrade time (no check-in). Only WAITING tickets (not CALLED/GRACE/MISSED). One active ticket per person per queue: buying a pass while holding a ticket upgrades it, never a second ticket. |
| Next rule | Engine-enforced; staff cannot pick a priority person. Triage first (daily cap); else the priority head if due; else the next regular. Due = credit counter: +1 per regular call, −N per priority call, capped at N (no burst after a quiet period). No priority waiting → regulars as normal. |
| Settings | All business-set, no platform limits: on/off (default OFF), price, ratio N (any whole number ≥ 1, 1-in-1 allowed; the form prefills 1-in-2 when switched on), optional daily sales cap ("Sold out"), validity window, cancel refund % (default 50). |
| What regulars see | "Priority lane on · 1 in N" on the business page, join screen and ticket. People ahead and wait include expected priority calls (shared estimate + load-test invariant updated in Step 4). |
| Money | Served → kept, split business/Qpeer (demo 70/30). Customer cancels before check-in → refund at the business's % (default 50). Never checked in by the end of the window → no refund. Checked in, missed, never rejoined → no refund. Checked in but the queue closed before serving them, or the business cancels or closes early → full refund, automatic (§10.5). |
| Anti-misuse | Pass tied to the buyer's account (no transfer). 1 pass per account per queue per day, and the device hash recorded on purchases and upgrades so the same phone can't buy a second pass with another account (C2 rule extended to paid priority). Check-in needs GPS (a fake check-in only leads to Grace → Missed for the faker). Every call logged with its time (audit for staff favouritism). |
| No platform cap (owner's reasoning) | Businesses decide. Public ratings penalise unfair use: regulars rate low, reputation drops on the map, customers switch to alternatives. |
| Fit | OPD, government offices, labs, service centres, salons. Doctors with long fixed sessions need time-slot appointments: a separate later feature, not v1. |
| Later option | A customer "Running late" button that moves the person back N places by choice, before being called. |

### Decided 2026-10-18 (owner): clarifications C1–C6

The owner agreed the orchestrator's points.

| Question | Decision |
|---|---|
| C1 Credit counter | Starts at 0 when a session opens (the first priority holder waits N regular calls; no instant jump at opening). Triage calls add no credit. Regular calls add credit even if they end as No-show. Undo of Next also undoes the credit change. |
| C2 Upgrade offer | Hidden when the estimated saving is below a threshold (`upgradeMinSavingMin`, default 5 min). Never "save ~0 min" next to a price. |
| C3 Regular estimate | A range. Low = current estimate counting only priority holders already checked in. High = as if every N-th call goes to priority. The load-test checker uses the same rule. |
| C4 Ticket QR | The signed ticket QR carries the first name + last 4 phone digits only (signed, not encrypted). Staff see the full name in the console when online. |
| C5 Strikes | Paid/remote tickets that miss get no no-show strike; losing the fee is the penalty. Strikes stay for free walk-ins only (answers the earlier open question; A table above, §9.3 and HLD §5.2 / §6.4 aligned). |
| C6 Close | A queue that closes while paused counts as "closed before serving": every checked-in priority holder gets a full refund. Checked-in holders never carry over to the next day (refund instead), even with multi-day validity. |

### Decided 2026-10-18 (owner): ratings (Step 6 extra)

Replaces the older `reviews` idea (one per served token within 7 days, stars + text), superseded 2026-10-18.

| Question | Decision |
|---|---|
| Who rates | Every SERVED customer, in the app. |
| What | Two ratings, 0–5 stars each: customer experience and service quality. |
| Where shown | Map, business card, business page (where people choose a queue). |
| Why | Completes the fairness loop: a business that favours priority too much gets rated low by regulars and loses customers. |
| Data | `ratings` table (§8), `POST /v1/tokens/:id/rating` (§12). The lane is stored per rating. Stars only, no text. |
| RT1 Split by lane (decided 2026-10-18) | Show "Regular customers 2.1★ · Priority customers 4.8★" next to "Priority lane on · 1 in N", so a blended average can't hide unfairness. |
| RT2 Integrity (decided 2026-10-18) | Only a served ticket can rate, once per ticket. Ratings shown only after at least 5 ratings (counted per lane, since RT1 shows lanes apart). The business cannot delete ratings but can reply publicly. |

### Built in Step 4 (2026-10-29, branch `feat/step4-backend`) — engine details and readings to confirm

| Question | Built as |
|---|---|
| Upgrade number | An upgraded ticket keeps its number (e.g. `14`) and its signed ticket stays valid; `lane: priority` marks it. Passes get P1, P2… at check-in. |
| Lanes | The lane is the sort-key rank (0 triage, 1 priority, 2 regular). `next` and people-ahead use the shared `priority.ts` (`nextLane`, `callOrder`, `regularPeopleAhead`, `priorityPeopleAhead`); the console lists waiting tokens in predicted call order. A skipped triage token that lands in a lower lane is called from that lane. |
| Credits | Change by the lane called from (+1 regular, −N priority, 0 triage); stored in DO meta, saved in the undo record, reset at open. |
| BOOKED in D1 | `session_id = ''`, `number = 0`; the unique (queue, session, series, number) index is partial (`WHERE session_id <> ''`, migration 0006). |
| Close money | Every paid token a close ends is refunded in full, except a MISSED one at a normal close, which is forfeited. A manual close inside the posted hours counts as "closing early" (MISSED fees refunded too); auto-close never does. Business deactivate / queue archive = "the business cancels": BOOKED passes refunded, nothing carries over. |
| Money path | The DO never calls Razorpay: it writes `payment` outbox items (applied with the token rows) that set D1 `refund_due` (with `refund_paise`) or `forfeited` + a ledger `forfeit` marker. The Worker makes the refund right after a close/cancel; the 15-min cron catches the rest. Refunds are idempotent by receipt = our payment id. |
| Ledger ids | Deterministic (`capture:<id>`, `capture_business:<id>`, `refund:<id>`, `forfeit:<id>`…) with `ON CONFLICT DO NOTHING`. |
| Split | Platform constant `DEMO_BUSINESS_SHARE_PCT = 70`, stored per payment (`business_share_pct`); the queue setting `businessSharePct` is not used. |
| Reservation cancel window | Refund when cancelled at least `cancelWindowMin` before the estimated call (HLD §9 text), not "within N min of joining". |
| Sales cap / pass limit | Passes and upgrades both count for the daily cap and for "1 per account and phone per queue per day" (refunded ones too). An unpaid order of the same user is returned again. |
| Upgrade offer | The server refuses an upgrade order below the saving threshold (`invalid_state`, `details.reason = saving_below_threshold`). |
| Walk-in while holding a pass | `already_in_queue` (one active ticket per person); a remote reservation still doesn't block a walk-in (unchanged). |
| WAITING validity end | A paid reservation whose C4 validity runs out is refunded; a MISSED one expires as a no-show; a BOOKED pass past its window is forfeited. |
| K guard | `avgServiceMs` below 1 s counts as 1 s (no division by zero). |
| Audit log | Every call, skip, rejoin, check-in, booking and upgrade logs `queue-do.audit` with its time (ids/labels only). |
| C4 names | Signed ticket: `cc` (check code), `fn` (first name ≤ 20 chars, non-ASCII escaped), `p4`. `GET /console` adds `holderName` from D1; sockets never carry names. |

Recorded note, not a rule: **RT3** for a monopoly provider (the only hospital nearby), ratings don't move customers but remain public evidence for oversight.
