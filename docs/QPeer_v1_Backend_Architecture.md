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
| 409 | `already_in_queue` | user already holds an active token in this queue |
| 409 | `queue_closed` / `queue_paused` / `queue_full` | joins rejected by queue state |
| 409 | `quota_full` | remote reservations quota reached for this hour |
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
| `businesses` | id, owner_user_id, name, category, address, phone, lat, lng, geohash, hours_json, status (`draft`/`active`/`inactive`) | idx(status, lat, lng), idx(owner_user_id) | 1 |
| `business_members` | business_id, user_id, role (`owner`/`staff`) | pk(business_id, user_id), idx(user_id) | 1 |
| `queues` | id, business_id, name, status (`active`/`archived`), settings_json, settings_version | idx(business_id) | 1 |
| `queue_snapshots` | queue_id (pk), business_id, lat, lng, is_open, is_paused, waiting, eta_low_ms, eta_high_ms, now_serving, updated_at | idx(lat, lng) | 2 |
| `tokens` | id, queue_id, session_id, business_id, user_id, number, series (`R`/`P`/`T`), class, method (`walkin`/`remote`/`staff`), state, joined_at, called_at, served_at, ended_at, end_reason, payment_id | idx(user_id, state), idx(queue_id, session_id), unique(queue_id, session_id, series, number) | 2 |
| `devices` | user_id, expo_push_token, platform, last_seen_at | pk(expo_push_token), idx(user_id) | 2 |
| `push_tickets` | id (Expo ticket id), token_id, kind, sent_at, receipt_checked_at, status | idx(receipt_checked_at) | 2 |
| `free_lane_strikes` | user_id, at (one row per no-show) | idx(user_id, at) | 2 |
| `payments` | id, user_id, queue_id, business_id, token_id, kind (`reservation`/`priority`), amount_paise, razorpay_order_id, razorpay_payment_id, status, refund_id, expires_at | unique(razorpay_order_id), unique(razorpay_payment_id), idx(user_id), idx(status, expires_at) | 4 |
| `ledger_entries` | id, payment_id, business_id, kind (`capture`/`refund`/`forfeit`/`business_share`/`platform_share`), amount_paise, at | idx(business_id, at), idx(payment_id) — **append-only** | 4 |
| `webhook_events` | id (Razorpay event id), type, received_at, processed_at | pk(id) — dedupe | 4 |
| `analytics_hourly` | queue_id, business_id, hour_start (IST hour, epoch ms), joins, leaves, served, no_shows, cancels, sum_wait_ms, waits, sum_interval_ms, intervals, eta_hits, eta_total | pk(queue_id, hour_start), idx(business_id, hour_start) | 2 (written), 5 (read) |
| `reviews` *(x)* | id, token_id, business_id, user_id, stars, text | unique(token_id) | 6 |

**Settings JSON** (`queues.settings_json`, validated by a shared zod schema with defaults): `joinRadiusM` 150, `walkinQuotaPct` 50, `reservationFeePaise` 2000, `priorityFeePaise` 10000, `priorityPerRegular` 0 (off), `businessSharePct` 70, `graceMinutes` 10, `cancelWindowMin` 15, `counters` 1, `maxSize` 300, `serviceMinutesHint` 5, `triageDailyCap` 5, `paidPerUserCap` 2. Changing settings increments `settings_version`; the QueueDO receives the new settings and applies them to **new** tokens only.

**Business hours** (`hours_json`): `{ mon: [{ from: "09:00", to: "13:00" }, ...], ... }` — multiple ranges per day, empty array = closed.

**Migrations:** Drizzle `drizzle-kit generate` → SQL files in `drizzle/migrations` → `wrangler d1 migrations apply DB --env <env> --remote`. Migrations are forward-only; dev data can be wiped before the demo.

---

## 9. The Live Queue: QueueDO

One Durable Object per queue, addressed by `idFromName(queueId)`. All operations on a queue are serialized through it, which is what makes numbering atomic without locks.

### 9.1 Sessions

A **session** is one open→close cycle (normally one day). Opening a queue starts a session (`sessionId`), numbers restart at 1, and closing ends it (remaining tokens expire, paid ones are refunded). Analytics and history keep the `sessionId`.

### 9.2 DO storage (its own SQLite)

| Table | Contents |
|---|---|
| `meta` | key/value: queueId, businessId, sessionId, status (`closed`/`open`/`paused`), nextNumber per series, nowServing, settings JSON + version, EWMA mean/variance, lastCallAt, pausedSince, pausedTotalMs, lastNextUndo |
| `tokens` | id, number, series, class, method, userId, state, sortKey, joinedAt, calledAt, counter, graceUntil, paymentOrderId, alertFlags |
| `intervals` | recent Next-to-Next intervals (last ~50) for the median used in outlier capping |
| `outbox` | id, kind (`d1_write` / `push`), payload JSON, attempts, nextAttemptAt |
| `hourly` | counters for the current IST hour (flushed through the outbox) |

### 9.3 Token states

```text
WAITING ─next─► CALLED ─served─► SERVED
   │              └─no-show─► GRACE ─admit─► CALLED (front)  ─served─► SERVED
   │                              └─timer─► EXPIRED
   ├─leave───────► LEFT
   ├─cancel──────► CANCELLED (refund decided by the Worker)
   └─queue closed► EXPIRED
```

Terminal: `SERVED`, `EXPIRED`, `LEFT`, `CANCELLED`. A token is **active** while `WAITING`, `CALLED` or `GRACE`.

### 9.4 Order and "people ahead"

`sortKey = classRank * 1e12 + sequence`, where `classRank` is 0 for triage, 1 for priority, 2 for regular, and `sequence` increases per allocation (for remote reservations: at payment confirmation).
- **People ahead** = `COUNT(*) WHERE state = 'WAITING' AND sortKey < mine`, using an index on `(state, sortKey)`. This is exact after leaves, cancels and skips, and fast for thousands of tokens, so the Fenwick tree from the early design isn't needed.
- **Priority limit** (when enabled): a priority token's sequence is pushed back so that at most 1 priority entry is served per `priorityPerRegular` regular tokens.
- **Skip** gives the token a new sequence equal to "after the next N waiting tokens" (N = 3 by default) — decided once, documented in tests.

### 9.5 RPC interface (called only by the Worker)

| Method | Effect | Notes |
|---|---|---|
| `init(queueId, businessId, settings)` | Store identity + settings | Idempotent |
| `updateSettings(settings, version)` | New settings for new tokens | Ignores older versions |
| `open()` / `close()` | Start/end a session | `close` returns paid tokens to refund |
| `pause()` / `resume()` | Pause state, paused time excluded from ETA | |
| `allocate({ method, userId, cls, paymentOrderId? })` | New token at the end of its class | Checks: open, not full, one active free token per user, paid cap per user, walk-in quota for `remote`. **Idempotent by `paymentOrderId`.** |
| `checkQuota(userId)` | Can a remote reservation be made right now? | Used before creating a Razorpay order |
| `next(counter)` / `undoNext()` | Call the next token; undo within 30 s | Records interval |
| `skip(tokenId)` / `noShow(tokenId)` / `admit(tokenId)` / `served(tokenId)` | Staff actions | |
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
- **Be-back-by** = expected call − 5 min buffer. **Leave-home-by** = expected call − (straight-line distance ÷ 20 km/h) − 10 min buffer.
- The math lives in `packages/shared` (pure functions) so the app can display consistent values; the DO is the source of the numbers it sends.
- ETA accuracy for analytics: when a token is called, record whether the call time fell inside the range shown at join.

### 9.7 Single-alarm scheduler

A DO has one alarm. The scheduler computes the earliest of:
- the next grace expiry,
- the next snapshot flush (only while the queue changed since the last flush; at most every 30 s),
- the next outbox retry,
- the next "head back now" alert time for any token,
- the hourly analytics flush (top of the IST hour),

and calls `setAlarm(earliest)`. `alarm()` handles everything due, then reschedules. Alarms survive DO restarts.

### 9.8 Outbox (DO → D1 and push)

The DO never writes to D1 or sends pushes inline in a way that could be lost. Instead it writes an **outbox row in its own storage in the same operation** as the state change, then drains the outbox immediately (best effort) and again on the alarm (retry with backoff: 5 s, 30 s, 2 min, 10 min, then every 30 min).

| Outbox kind | Target | Idempotency |
|---|---|---|
| `token_upsert` | D1 `tokens` | upsert by token id, guarded by state order (never move backwards) |
| `snapshot` | D1 `queue_snapshots` | upsert by queue id with `updated_at` guard |
| `analytics` | D1 `analytics_hourly` | additive upsert keyed by (queue_id, hour_start); each outbox item applied once (outbox id stored in the batch) |
| `strike` | D1 `free_lane_strikes` | insert with outbox id as row id |
| `forfeit` / `refund_request` | Worker payments service (via D1 `payments` status + cron pickup) | payment status transitions are idempotent |
| `push` | Expo Push API | dedupe by (token id, alert kind) flag set before sending |

### 9.9 Live updates (WebSocket protocol)

- The app opens `wss://…/v1/queues/:queueId/live?tokenId=…` (Firebase token in `Sec-WebSocket-Protocol` or a short-lived ticket — Step 2 decides; never in a URL query). The Worker authorizes, then forwards the upgrade to the DO.
- Hibernation API: `ctx.acceptWebSocket(ws, [tokenId])`; attachment stores the token id.
- Server → client messages (`protocol.ts`, zod in shared):
  - `{ type: "token", token: TokenView }` — personal state: number, state, peopleAhead, nowServing, etaLow/High, beBackBy/leaveHomeBy, counter
  - `{ type: "queue", status, nowServing, waiting }` — for staff consoles
  - `{ type: "ping" }` every 30 s
- Clients reconnect with backoff and always refetch `GET /v1/tokens/:id` after reconnecting (TOK-02, TOK-03). The socket is a fast path, never the only path.
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

1. **Create order** `POST /v1/queues/:id/orders { kind }` — `requireRegistered`; DO `checkQuota`; amount from queue settings; create Razorpay order (receipt = our payment id); insert `payments` row `created` with `expires_at` = now + 30 min.
2. **App pays** with Razorpay Checkout using the order id.
3. **Client confirmation** `POST /v1/payments/verify { orderId, paymentId, signature }` — verify `HMAC_SHA256(orderId|paymentId, keySecret)`; then `confirmPayment(orderId, paymentId)`.
4. **Webhook** `POST /v1/webhooks/razorpay` — verify `X-Razorpay-Signature` = `HMAC_SHA256(rawBody, webhookSecret)` **on the raw body before parsing**; dedupe by event id in `webhook_events`; `payment.captured` → `confirmPayment(...)`; `refund.processed` → mark refund done.
5. **`confirmPayment`** (shared by 3 and 4, idempotent): if already `allocated`, return the token. Else D1 status → `captured`; DO `allocate(... paymentOrderId)`; on success → `allocated` + token id; on `quota_full`/`queue_closed` → refund via API → `refunded`. Ledger rows are written in one D1 batch with the status change.
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
- Fetch Razorpay payments for the last day (test mode) and compare with D1; log mismatches as errors.

---

## 11. Notifications

- `devices` holds Expo push tokens per user (upsert on app start and on token change; removed on sign-out) — ALR-02.
- Sending: the DO outbox calls the Expo Push API (`https://exp.host/--/api/v2/push/send`) in batches of up to 100, stores ticket ids in `push_tickets`; an hourly cron checks receipts and deletes `DeviceNotRegistered` tokens.
- Alert kinds (ALR-03): `head_back`, `next`, `called`, `grace_started`, `refund_issued`, `queue_paused`, `queue_closed`. Each is sent at most once per token (flag set in the DO before sending).
- Android channel `queue-alerts` (high importance) is created by the app; the payload names it.

---

## 12. Map and Discovery

- `GET /v1/map?minLat&minLng&maxLat&maxLng&category` → one D1 query: `businesses` (status `active`, has pin, has at least one queue) joined with `queue_snapshots`, filtered by the bounding box, limited to 200 results. Indexes on `(lat, lng)` make this fast at city scale.
- Business detail `GET /v1/businesses/:id` → profile + queues with snapshots + public stats (average wait and service time over the last 28 days from `analytics_hourly`).
- Snapshots are at most ~30 s old (MAP-02); the app polls the visible area every 30 s while the map is visible.
- Geohash is stored for later (clustering on the server, larger areas); v1 uses the bounding box only.

---

## 13. Analytics

- The DO counts joins, leaves, served, no-shows, cancels, waits, intervals and ETA hits per IST hour in its `hourly` table, and flushes to `analytics_hourly` through the outbox at the end of each hour and on queue close.
- Insights (`/v1/businesses/:id/analytics?range=7d|28d`) are computed **on read** with SQL aggregates over `analytics_hourly` — no rollup tables in v1.
- No customer identities in analytics tables.

---

## 14. Scheduled Jobs (`scheduled()`)

| Schedule | Job |
|---|---|
| every 15 min | expire unpaid orders; close queues past their business closing time (if auto-close is on) |
| hourly | check Expo push receipts; prune dead push tokens |
| daily 03:00 IST | payment reconciliation; delete `webhook_events` older than 30 days |

Cron handlers are thin and call the same services as the API, so they are tested the same way.

---

## 15. Rate Limiting

- Queue-level limits are enforced by the DO itself (one active free token per user per queue, paid cap per user, max size, triage cap).
- Endpoint-level limits (join, order, verify) use a simple per-user fixed window counter. v1 implementation: the Workers Rate Limiting binding if available on the plan, otherwise a small D1 counter table keyed by `(user_id, action, window)`. Decided in Step 2.
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
| `RAZORPAY_KEY_ID` | var | test key id (public) |
| `RAZORPAY_KEY_SECRET` | **secret** | `wrangler secret put` per env; `.dev.vars` locally |
| `RAZORPAY_WEBHOOK_SECRET` | **secret** | same |
| `EXPO_ACCESS_TOKEN` | **secret** (optional) | only if Expo push security is enabled |
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

---

## 20. API Catalogue (v1)

`A` = any signed-in user (anonymous OK), `R` = registered, `S` = staff of the business, `O` = owner, `P` = public, `D` = dev env only.

| Module | Method + path | Auth | Purpose (checklist) |
|---|---|---|---|
| Platform | `GET /v1/health` | P | PLT-02 |
| Identity | `GET /v1/me` · `PATCH /v1/me` (displayName) | A | IDN-06 |
| Identity | `POST /v1/me/devices` · `DELETE /v1/me/devices/:pushToken` | A | ALR-02 |
| Business | `POST /v1/businesses` · `GET /v1/me/businesses` | R | BIZ-01, BIZ-09, BIZ-15 |
| Business | `GET /v1/businesses/:id` | A | public detail (MAP-05); owner gets extra fields |
| Business | `PATCH /v1/businesses/:id` (profile, pin, hours) | O | BIZ-02, BIZ-04, BIZ-05 |
| Business | `POST /v1/businesses/:id/deactivate` · `/activate` | O | BIZ-08 |
| Queues | `POST /v1/businesses/:id/queues` · `PATCH /v1/queues/:id` (name, settings) · `POST /v1/queues/:id/archive` | O | BIZ-10–12 |
| Queues | `GET /v1/queues/:id` (public info + live summary) | A | JON-03 |
| Console | `POST /v1/queues/:id/{open,close,pause,resume,next,undo-next,triage}` | S | BIZ-13, QUE-05–12 |
| Console | `POST /v1/queues/:id/tokens/:tid/{skip,no-show,admit,served}` | S | QUE-06, QUE-08 |
| Console | `GET /v1/queues/:id/console` (full live state) | S | console screen |
| Join | `POST /v1/queues/:id/join` `{ lat, lng, accuracyM, mocked }` | A | JON-04–07 |
| Tokens | `GET /v1/me/tokens?status=active\|recent` | A | TOK-06 |
| Tokens | `GET /v1/tokens/:id` · `POST /v1/tokens/:id/leave` · `POST /v1/tokens/:id/cancel` | A (owner of token) | TOK-01, TOK-05 |
| Live | `GET /v1/queues/:id/live` (WebSocket) | A | TOK-02 |
| Map | `GET /v1/map?bbox…&category` | A | MAP-01–04 |
| Payments | `POST /v1/queues/:id/orders` · `POST /v1/payments/verify` · `GET /v1/me/payments` | R | PAY-01–05, PAY-11 |
| Payments | `POST /v1/webhooks/razorpay` | P (signature) | PAY-04, PAY-07 |
| Insights | `GET /v1/businesses/:id/analytics?range=` · `GET /v1/businesses/:id/earnings?range=` | O | INS-01–08 |
| Dev | `POST /v1/dev/seed` · `POST /v1/dev/simulate` · `GET /v1/dev/queue-ping/:id` | D | DEM-01–06 |

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
| WebSocket auth: Firebase token in `Sec-WebSocket-Protocol` vs short-lived ticket from `POST /v1/queues/:id/live-ticket` | 2 |
| Rate limiting: Workers Rate Limiting binding vs D1 counters | 2 |
| Skip semantics: behind next 3 vs to the end | 2 |
| Razorpay Route availability in test mode (split in ledger only if not) | 4 |
| Priority Pass rules (limit or none) — setting already supported | 6 |
