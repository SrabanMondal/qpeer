# QPeer — Privacy-Preserving, Serverless Virtual Queue

> **Status (October 2026): still valid for the queue core and the free walk-in lane.**
> Two changes:
> - Walk-ins are now checked with **static QR + a one-time GPS check** (default radius 150 m with a forgiving accuracy allowance, location never stored). The BLE sections describe an optional strict mode for later.
> - The "no accounts, no phone number" rule now applies **only to the free walk-in lane**.
> Paid reservations, Priority Pass and ratings need a light account. Map, payments, ratings and analytics are covered in `QPeer_Platform_Architecture_and_Build_Plan.md`.
> - *Updated 2026-10-18:* the triage lane (§5, §24B) is now separate from the paid Priority Pass, which follows a 1-in-N credit rule set by each business. Missed turns go GRACE → MISSED → one rejoin → EXPIRED (§10). The GPS checks for "I'm here" and for Priority Pass check-in work like the walk-in check: the location is never stored. v1 counts people ahead with an indexed SQL `COUNT` in the Durable Object instead of a Fenwick tree; the formulas below stay as the design idea. Current rules: `QPeer_v1_High_Level_Design.md` §5.2.

## 1. Project Overview

**QPeer** is a privacy-preserving virtual queue system with a native provider application, a lightweight native participant application for secure proximity-based admission and remote queue monitoring, and a provider-assisted physical fallback for participants without compatible devices or connectivity.

The core interaction is:

> **Scan static QR → verify BLE proximity with provider → receive queue number → walk away → track position & ETA remotely → return when notified.**

The architecture provides the convenience and reliability of a virtual queue without requiring:

- user accounts or passwords
- phone numbers or email addresses
- a permanent user database or identity tracking
- a dedicated physical server per queue
- manual approval for every digital participant
- complex peer-to-peer networking
- continuous presence near the service counter

The proposed architecture uses **serverless cloud infrastructure**, with each queue represented as a lightweight isolated stateful object (e.g., Cloudflare Workers + Durable Objects).

The system is designed around three primary pillars:

1. **Extremely easy creation, joining, and walking away**
2. **Gating against remote/fake participants via Static QR + BLE proximity verification**
3. **Strict privacy-by-design with zero identity or PII collection**

---

# 2. Core User Experience

## Service Provider App

The service provider operates via the dedicated **QPeer Provider mobile app**.

The provider app is responsible for:

- Creating queues (name, service type, estimated duration, expiry)
- Displaying/managing live queue state
- `NEXT`, `PAUSE`, `SKIP`
- Priority triage and holding tray operations
- Acting simultaneously as the local **BLE proximity anchor**

The provider does not need to hold their phone up to display a QR code or perform manual approvals for normal joins. The phone sits at the counter handling queue progression while QPeer handles BLE discovery in the background.

```text
Provider Phone
├── Queue management (NEXT, PAUSE, SKIP, Priority)
└── BLE proximity functionality (Beacon / Peripheral)
```

---

# 3. Participant Experience

### Primary Digital Flow (Participant App)

1. The participant scans a physical static QR code at the entrance (`qpeer://queue/<queue-id>`).
2. The lightweight **QPeer Participant App** opens.
3. The app discovers the nearby provider phone via BLE and executes a cryptographic challenge/response.
4. The server validates the provider ↔ queue relationship and atomically allocates a queue position.
5. The participant receives their anonymous queue credential and live position.
6. The participant is free to **walk away** (sit in the shade, run errands, rest). BLE is no longer required once joined.
7. As their turn approaches, they receive live updates and background push notifications.

```text
Doctor Consultation
Your number: #47
Currently serving: #42
People ahead: 4
Estimated wait: ~18 minutes (likely range: 15–22 min)
[🔔 Notification: Active]
```

### Universal Manual Fallback Flow

For participants without smartphones, internet access, or Bluetooth:
1. The provider taps **+ Add Person** in the Provider App.
2. The server allocates the next sequential position in the same single queue.
3. The provider issues a physical bearer credential with a claim code (e.g., `#47`, Claim code: `829461`).
4. The participant waits using physical displays/audio calls, or can later convert to digital by entering the claim code in the participant app.

---

# 4. Serverless Architecture

A good initial architecture to explore is:

```text
                         Internet
                            │
                            ▼
                    ┌───────────────┐
                    │ Edge / Worker │
                    └───────┬───────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │ Queue Object    │
                   │                 │
                   │ current number  │
                   │ next number     │
                   │ participants    │
                   │ join credential │
                   │ expiry          │
                   └────────┬────────┘
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
          Client          Client         Client
            #42             #43            #44
```

A platform such as **Cloudflare Workers + Durable Objects** is a strong candidate for experimentation.

The conceptual model is:

> **One logical queue = one isolated serverless state object.**

This avoids provisioning traditional servers or creating a database instance for each queue.

An optional relational store can later be added for non-essential metadata such as:

- creator accounts
- billing
- abuse analytics
- aggregate statistics

However, the core active queue does not need a traditional persistent database.

---

# 5. Why Queue-Per-Object Is Attractive

A queue can be represented by a very small state machine:

```text
QueueState
-------------------------
queue_id
current_number
next_number
join_credential
expires_at
status
-------------------------
```

Participant-specific state can be minimal:

```text
Participant
-------------------------
anonymous_id
queue_id
position
notification_threshold
-------------------------
```

The important design principle is:

> **Do not rewrite every participant record every time the queue advances.**

If nobody ever left the queue, participants could calculate:

```text
people_ahead = my_number - current_number - 1
```

But participants can **leave**. The numbers ahead of me then contain gaps, and the subtraction over-counts.

The correct quantity is:

```text
people_ahead = count of participants still waiting ahead of me
```

This can still be computed without rewriting participant records, using a **Fenwick tree (binary indexed tree)** indexed by integer queue number for the regular queue, combined with a separate **Priority Lane**:

```text
Regular Queue (Fenwick Tree):
JOIN  #n  → add(n, +1)
LEAVE #n  → add(n, -1)
NEXT  #n  → add(n, -1)
regular_ahead(#m) = prefix_sum(m - 1)
```

Two small lanes sit beside the regular queue: the free **triage lane** (`T1`, `T2`, …, inserted by staff for medical urgency) and the paid **priority lane** (`P1`, `P2`, …, Priority Pass holders, ordered by check-in time). Each participant's waiting count remains exact and cheap:

- **Triage is always served first.** Every participant counts the active triage tokens ahead of them.
- **The paid priority lane is not served before the whole regular queue.** It follows a **credit rule**: each regular call adds 1 credit (capped at N), and the head of the priority lane is called only when credits reach N (then N credits are spent). N is the business's ratio, "1 priority per N regulars". Staff cannot pick a priority person by hand.
- **For a regular participant (#m):**
  ```text
  people_ahead(#m) = active_triage_ahead + prefix_sum(m - 1) + expected_priority_calls(m)
  ```
  `expected_priority_calls` is a range. Low: only priority holders already checked in. High: as if every N-th call goes to priority.
- **For a priority participant (#Pk):**
  ```text
  people_ahead(#Pk) = active_triage_ahead + earlier_priority_ahead + regular calls still needed before #Pk is due
  ```

Each operation remains $O(\log n)$ for the regular queue and $O(1)$ / $O(k)$ for the small lanes (where $k \ll n$), so queue advancement stays extremely cheap even with 10,000 participants, and the queue object can answer "how many are ahead of me?" for any participant on demand without renumbering or fractional keys.

---

# 6. Scalability Principle: Minimize Fan-Out

The expensive part of a realtime queue system is not necessarily storing one million small participant records.

The expensive part can be **broadcasting every queue update to every connected participant**.

A naïve design might do:

```text
NEXT
 ↓
Update queue
 ↓
Notify 10,000 participants
```

For a large queue this creates unnecessary realtime traffic.

Instead, use proximity-based updates.

### Participants far from the front

They may only need occasional updates.

### Participants approaching the front

They enter a realtime notification group.

For example:

```text
Queue:

#1  ← currently being served
#2
#3
...
#500
...
#8000
```

A participant at #8000 does not need every single `NEXT` event.

A participant at #4 does.

Therefore:

```text
                 Queue state
                     │
          ┌──────────┴──────────┐
          │                     │
       Far away             Approaching
          │                     │
   Low-frequency             Realtime
      updates                 updates
```

This can make the system substantially more cost-efficient at scale.

---

# 7. Anonymous Participant Identity

Participants do not need conventional accounts.

A browser/device can generate a cryptographic key pair:

```text
private key
    +
public key
```

The public key, or a hash derived from it, can serve as the participant's anonymous identifier.

Example:

```text
Participant ID:
8c91...a72f
```

The system only needs to know:

> This anonymous cryptographic identity owns queue position #47.

It does not need:

- name
- phone number
- email
- social account

The private key remains on the participant's device.

This provides a clean privacy-by-design model.

---

# 8. Static QR Discovery + BLE Proximity Verification

The architecture replaces rotating QR codes and specialized NFC hardware with:

> **Static QR for queue discovery + BLE proximity for admission authorization.**

The QR code only identifies the queue:

```text
qpeer://queue/<queue-id>
```

Possessing the QR code or URL alone is **never** sufficient to obtain a queue token.

### 8.1 Provider Phone as the Proximity Anchor

Because the service provider already uses the QPeer Provider App to operate the queue, the provider's phone simultaneously acts as the local BLE proximity beacon.

```text
Provider Phone
├── Queue management (NEXT, PAUSE, SKIP, Priority)
└── BLE proximity functionality (Beacon / Peripheral)
```

The provider does not need to hold the phone up to display a QR or perform extra admission steps. The phone remains on the counter available for normal queue management.

### 8.2 New Participant Admission Flow

```text
Scan static QR
    ↓
Obtain queue_id
    ↓
Open QPeer participant app
    ↓
Discover nearby QPeer provider through BLE
    ↓
Perform cryptographic challenge/response
    ↓
Server verifies provider ↔ queue relationship
    ↓
Server atomically allocates queue position
    ↓
Participant receives queue credential
```

BLE serves strictly as the proximity/discovery mechanism, not the cryptographic trust anchor by itself. The server verifies a cryptographic proof associated with the authorized provider session.

### 8.3 Actual Physical-Presence Security Goal

The security objective is specifically:

> **Prevent a remote person from obtaining a queue position using only a publicly shared QR code or queue URL.**

```text
Remote person
    ↓
Obtains QR screenshot / shared URL
    ↓
Scans QR
    ↓
No nearby provider detected via BLE
    ↓
Rejected (cannot obtain token)
```

Whereas:

```text
Person near service location
    ↓
Scans static QR
    ↓
Detects provider through BLE
    ↓
Cryptographic verification
    ↓
Receives queue token
```

QPeer is not attempting to prove exact indoor positioning or sub-meter distance; it specifically defeats remote queue hoarding, tout networks, and automated bot joins.

### 8.4 Static QR Hardware Is Sufficient

Because the QR code is static and does not rotate:
- Printed paper QR poster
- Laminated QR card / standee
- Static display monitor or TV
- Low-power e-paper display
- Low-cost acrylic standee

The provider's phone is responsible for queue management and proximity verification rather than QR display.

### 8.5 BLE Is Required Only During Admission

BLE is only needed to establish proximity when joining. After receiving a valid queue credential:

```text
Join ──> Receive #47 ──> Leave physical location ──> BLE no longer needed ──> Receive live updates / alerts ──> Return when called
```

The participant does not need to remain near the provider. They can walk away, run errands, or rest, directly supporting QPeer's core mission: **keep your place in line, not your spot on the floor.**

---

# 9. Additional Anti-Abuse Controls

The system can combine several lightweight mechanisms:

### Cryptographic participant identity

Prevent the same participant identity from joining repeatedly.

### Join credential

Require possession of the current queue credential.

### Rate limiting

Limit join attempts per credential/device/network where appropriate.

### Queue capacity

The creator can optionally define:

```text
Maximum queue size: 100
```

### Optional proof-of-work

For suspicious/high-volume requests, require a small computational challenge.

This should be a fallback rather than the normal joining experience.

### No public join API without credential

The queue identifier alone should not be sufficient to join.

---

# 10. Queue Lifecycle & Grace Period State Machine

Queues should preferably be ephemeral, and participant state progression must account for real-world delays and missed turns.

### Queue Lifecycle

```text
CREATED
   ↓
OPEN
   ↓
SERVING
   ↓
COMPLETED
   ↓
EXPIRED
```

After expiry, the active queue state can be deleted. This provides an additional privacy advantage: the system does not retain historical participant information forever.

### Missed Turns & Grace Period Handling

The original assumption of strict progression where missed turns were immediately skipped caused user friction. To prevent front-desk arguments and accommodate delayed patients, a temporary holding state is introduced:

* **Updated State Machine:** The serverless participant state machine expands from `WAITING`, `CALLED`, and `EXPIRED` to include `GRACE` and, since 2026-10-18, `MISSED`.
* **The Holding Queue:** If a participant is a no-show when called, the clerk selects "No Show". The participant is dropped from the active people-ahead count (allowing the line to advance instantly) and moved to a "Late Arrivals" holding tray on the clerk's dashboard.
* **Grace via Alarms:** A serverless alarm (Cloudflare Durable Object Alarm) starts the grace countdown (a business setting, default 10 min). The ticket shows a large "Come now — m:ss left" countdown.
* **Fast-Track Readmission:** If the user arrives during the grace period, the clerk selects "Admit". The user is served right after the current person, without being forced to restart at the back.
* **Missed, then one rejoin:** When the alarm fires, the token becomes `MISSED` (out of the line, not ended), and one `missed` alert is sent. The participant can tap **I'm here** once. The app repeats the walk-in GPS check; the location is used only for that check and is **never stored**, exactly as for joining. Within the business's late window the token goes back by about `rejoinDelayMin` minutes of service (converted to people with the queue's own service time, at least 1); after the window it goes to the end.
* **Expiry:** A second miss, or no rejoin before the queue closes, ends the token as `EXPIRED`.

```text
[ WAITING ] ──(Called)──> [ CALLED ] ──(No-Show)──> [ GRACE ] ──(Timer)──> [ MISSED ] ──(Close / 2nd miss)──> [ EXPIRED ]
                             │                         │                       │
                         (Served)                  (Admit)              ("I'm here", once,
                             │                         │                 GPS check, not stored)
                             v                         v                       v
                        [ COMPLETED ]         [ RE-ADMITTED (NEXT) ]   [ WAITING, moved back ]
```

---

# 11. Native Mobile Apps as the Core Architecture

The architecture relies on two focused native mobile applications rather than a browser/PWA-only model:

### 11.1 Service Provider App
The provider app runs on the service provider's existing smartphone or counter tablet. It is responsible for:
- Creating and configuring queues
- Operating the queue (`NEXT`, `PAUSE`, `SKIP`, `Priority Insert`, `No Show`, `Admit Late Arrival`)
- Emitting the local BLE proximity beacon in the background
- The provider does not need to perform manual approvals for normal joins; the app handles BLE discovery seamlessly while they manage the counter.

### 11.2 Lightweight Participant App
The participant app is the primary digital experience, intentionally kept small, fast, and focused:
- Static QR code scanning (`qpeer://queue/<queue-id>`)
- BLE proximity discovery and cryptographic challenge/response
- Secure on-device storage of anonymous cryptographic keypairs
- Live queue position, people ahead, and adaptive ETA range
- Reliable OS-level background notifications when approaching turn
- One-tap "Leave Queue" action

The participant app is not a bloated, general-purpose application; it exists purely to provide a seamless, secure queue experience.

### 11.3 Notification Is a Convenience Layer
Notifications are a convenience layer, not the source of truth. The authoritative state remains the server-side queue object:
- **Notification delivered:** Participant gets alerted on time.
- **Notification delayed/missed:** The queue position remains fully valid. The participant can simply reopen the app to check their live position.

---

# 12. Universal Manual Fallback & Claim Codes

QPeer never makes a modern smartphone, active internet connection, or participant app a prerequisite for receiving service.

### 12.1 Provider-Assisted Manual Join
If a participant cannot use the digital flow (no smartphone, button phone, no internet, or no Bluetooth):
1. The provider taps **+ Add Person** in the Provider App.
2. The server allocates the next sequential position in the same queue.
3. The provider gives the participant a physical/bearer credential.

```text
Provider App ──[+ Add Person]──> Server allocates #47 ──> Print / Write Physical Credential
```

### 12.2 Manual Participant Credential
To ensure manual participants do not rely on memory or verbal calls:
- **Queue Number:** `#47`
- **Claim Code:** `829461` (one-time secret hash stored on the server)

This physical bearer credential proves ownership of the queue position without collecting any personal identity data.

### 12.3 Manual → Digital Conversion
A participant who joins manually can later install the QPeer participant app (e.g., while waiting or assisted by a family member) and claim their existing position:
1. Open QPeer participant app.
2. Enter queue ID and the 6-digit claim code.
3. Server validates the claim code, generates an anonymous device keypair, and binds the key to the existing queue position.
4. The one-time claim code is invalidated.
5. The participant immediately enjoys live notifications and remote status tracking without losing their spot.

### 12.4 Digital and Manual Participants Share the Same Single Queue
Separate queues are never created. The queue object is the single source of truth:

```text
Queue
├── #45 → digital participant
├── #46 → digital participant
├── #47 → manual participant (Claim Code: 829461)
├── #48 → digital participant
└── #49 → manual participant (Claim Code: 310574)
```

The sequence, priority, and timing calculations remain strictly unified.

### 12.5 Accessibility Guarantees
- **No Internet:** Provider serves as the connectivity bridge to the server.
- **No Smartphone / Button Phone:** Handled via physical bearer token and audio/display call.
- **No Bluetooth:** Handled via the manual provider-assisted path, ensuring BLE capability is never a barrier to receiving service.

---

# 13. Multi-Counter Support

The system can optionally support multiple service counters.

Example:

```text
              QUEUE
                │
        ┌───────┴────────┐
        ▼                ▼
    Counter 1         Counter 2
       │                  │
       ▼                  ▼
      #47                #48
```

When a counter becomes available, the queue manager presses:

> NEXT

The system can assign the next participant.

The participant could receive:

> 🟢 Please proceed to Counter 2.

This extends the system from a simple queue-number generator into a lightweight queue-management protocol.

---

# 14. Queue State as a State Machine

The queue can be modeled as events:

```text
CREATE_QUEUE
JOIN #1
JOIN #2
JOIN #3
SERVE #1
JOIN #4
SERVE #2
LEAVE #4
```

The current state is derived from these operations.

For a production implementation, it may be preferable to store only the minimum state required rather than retaining a complete event history.

The event model is nevertheless useful for reasoning about:

- consistency
- auditing
- recovery
- synchronization
- race conditions

---

# 15. Concurrency and Race Conditions

The queue must guarantee that two people cannot both receive the same number.

For example, if two users join simultaneously:

```text
User A ── JOIN ──┐
                 ├── Queue object
User B ── JOIN ──┘
```

The queue state update must be atomic.

The serverless queue object should effectively serialize operations:

```text
next_number = 47

JOIN A → assign #47
next_number = 48

JOIN B → assign #48
next_number = 49
```

This is one of the reasons a per-queue stateful serverless object is attractive.

---

# 16. Adaptive Queue Waiting-Time Calculation

This is an important extension and a good place to add a small amount of mathematics/AI.

The system should not simply say:

> "10 people ahead × 5 minutes = 50 minutes."

Real queues are variable.

Some customers take 30 seconds.

Others take 15 minutes.

Therefore, the system continuously learns the **observed service interval** as people are served.

---

## What the system can actually measure

The service provider only presses **NEXT**. There is no separate "service started" / "service finished" button, so the observable quantity is the time between consecutive NEXT presses on the queue (from any counter):

\[
d_i = t^{NEXT}_i - t^{NEXT}_{i-1}
\]

This interval is exactly what a waiting participant experiences. It automatically includes:

- the service itself
- time the provider waits for a participant who hasn't arrived before pressing NEXT
- the effect of multiple counters (with 3 counters, NEXT is pressed roughly 3× as often, so \(d_i\) shrinks on its own)

Intervals recorded while the queue is **paused** (breaks, shift change) are excluded.

---

## People ahead

Let \(A\) = number of participants still waiting whose number is lower than mine (participants who left are not counted — see Section 5).

The participant is called at the \((A+1)\)-th NEXT press from now.

---

## Basic Model

Maintain a recent history of intervals:

```text
D = {d1, d2, d3, ..., dn}
```

A simple estimate is the moving average:

\[
\hat{d} =
\frac{1}{n}\sum_{i=1}^{n}d_i
\]

Then, where \(e\) is the time elapsed since the last NEXT:

\[
EstimatedWait =
\max(\hat{d} - e,\ 0) + A \cdot \hat{d}
\]

The first term is the remainder of the current interval; the second is the \(A\) full intervals after it.

Example:

```text
Recent intervals:

4 min
6 min
5 min
8 min
7 min
```

Average:

\[
\hat{d} = 6\text{ minutes}
\]

If the participant has 7 people ahead and the last NEXT was pressed 2 minutes ago:

\[
EstimatedWait = (6 - 2) + 7 \times 6 = 46\text{ minutes}
\]

The UI can show:

> **7 people ahead · estimated wait ~46 min**

---

# 17. Exponentially Weighted Moving Average

A simple average gives old observations the same importance as recent observations.

A better adaptive model is an **Exponentially Weighted Moving Average (EWMA)**.

\[
S_t = \alpha d_t + (1-\alpha)S_{t-1}
\]

Where:

- \(d_t\) = most recent NEXT-to-NEXT interval
- \(S_t\) = updated estimated interval (used in place of \(\hat{d}\))
- \(\alpha\) = adaptation factor between 0 and 1

The spread can be tracked the same way, with an exponentially weighted variance:

\[
\delta_t = d_t - S_{t-1}, \qquad
S_t = S_{t-1} + \alpha\,\delta_t, \qquad
V_t = (1-\alpha)\left(V_{t-1} + \alpha\,\delta_t^2\right)
\]

and \(\sigma_t = \sqrt{V_t}\). (The middle expression is the same EWMA as above, rearranged.)

To stop one very long interval (for example an unannounced break) from distorting the estimate, cap \(d_t\) at a multiple of the recent median (e.g. \(5\times\)) before updating.

For example:

\[
\alpha = 0.3
\]

If service times suddenly become longer, the estimate adapts gradually.

This is computationally extremely cheap and does not require a machine-learning model.

---

# 18. Confidence / Uncertainty

A better UX should avoid pretending the estimate is exact.

Instead of:

> **Wait: 42 minutes**

show:

> **Estimated wait: 35–50 minutes**

The range comes from the observed variability of the intervals (\(\sigma_t\) from Section 17).

The wait is a sum of \(k = A + 1\) intervals. If intervals are roughly independent, their spread does **not** grow as \(k \times \sigma\) — it grows as \(\sigma\sqrt{k}\):

\[
\mathbb{E}[Wait] \approx k\,S_t, \qquad
SD[Wait] \approx \sigma_t\sqrt{k}
\]

(ignoring the elapsed-time correction from Section 16 for simplicity).

An approximate 80% range is:

\[
k\,S_t \;\pm\; 1.28\,\sigma_t\sqrt{k}
\]

with the lower bound floored at 0.

Caveat: service intervals are right-skewed (a few very long ones), so this normal approximation is poor when \(k\) is small — which is exactly when the participant is deciding whether to walk back. A robust alternative is a quick Monte-Carlo estimate:

```text
repeat 500 times:
    draw k intervals at random from recent history
    sum them
report 10th and 90th percentile of the sums
```

For \(k \le 100\) this is trivially cheap and needs no distribution assumption.

---

# 19. Queue Position + Dynamic ETA

The participant's state could therefore look like:

```text
┌─────────────────────────────┐
│       Doctor Queue          │
│                             │
│       Your number           │
│           #47               │
│                             │
│     Currently serving       │
│           #39               │
│                             │
│       7 people ahead        │
│                             │
│   Estimated wait: ~32 min   │
│   Likely range: 25–42 min   │
│                             │
│ 🔔 Notify me when #44       │
└─────────────────────────────┘
```

As service times are observed:

```text
Old estimate: 32 min
        ↓
New people served
        ↓
New estimate: 27 min
        ↓
New estimate: 34 min
```

The estimate dynamically changes.

---

# 20. Going Beyond a Simple Average — AI/ML Exploration

A later version could predict service time using additional contextual features.

Potential features:

- recent service times
- time of day
- day of week
- number of active counters
- counter identity
- queue size
- historical service-time distribution
- recent unusually long services

A simple regression model could predict:

\[
\hat{T}_{service} =
f(
recent\_service\_times,
time\_of\_day,
day,
active\_counters,
queue\_state
)
\]

Then, with \(k = A + 1\) and each interval predicted by \(f\):

\[
EstimatedWait =
\sum_{i=1}^{k}
\hat{d}_i
\]

Because intervals are measured at the queue level (NEXT on any counter), multiple counters are already reflected in \(d_i\). Adding `active_counters` as a feature lets the model react immediately when a counter opens or closes, instead of waiting for the average to catch up.

---

# 21. Adaptive Model Without Heavy AI

For the minor project, a full ML pipeline is probably unnecessary.

A strong progression would be:

### Level 1 — Static estimate

```text
ETA = (people_ahead + 1) × configured_interval
```

### Level 2 — Moving average

```text
ETA = (people_ahead + 1) × average_interval
```

### Level 3 — EWMA

```text
ETA = (people_ahead + 1) × EWMA_interval
```

### Level 4 — Prediction model

Use a lightweight regression/ML model to predict service duration.

This gives the project a clear experimental component:

> **Does adaptive estimation outperform the static configured estimate?**

That can become a measurable project result.

---

# 22. Possible Evaluation Metrics

You can evaluate the waiting-time algorithm using historical/simulated queues.

Useful metrics:

### Mean Absolute Error

\[
MAE =
\frac{1}{N}
\sum_{i=1}^{N}
|\hat{y}_i-y_i|
\]

Where:

- \(\hat{y}_i\) = predicted waiting time
- \(y_i\) = actual waiting time

### Root Mean Squared Error

\[
RMSE =
\sqrt{
\frac{1}{N}
\sum_{i=1}^{N}
(\hat{y}_i-y_i)^2
}
\]

### Interval coverage

MAE and RMSE only judge the single number. Since the UI shows a range \([L_i, U_i]\), also check that the range is honest:

\[
Coverage =
\frac{1}{N}
\sum_{i=1}^{N}
\mathbf{1}\left[L_i \le y_i \le U_i\right]
\]

An "80% range" should contain the actual wait about 80% of the time. Report it together with the average range width \(\frac{1}{N}\sum_{i}(U_i - L_i)\) — a very wide range trivially reaches 100% coverage and is useless.

### Late-arrival risk

The product's purpose is letting people wait elsewhere and come back in time. The most user-relevant metric is therefore: if a participant plans to be back by the lower bound \(L_i\), how often are they called before that?

\[
LateRisk =
\frac{1}{N}
\sum_{i=1}^{N}
\mathbf{1}\left[y_i < L_i\right]
\]

### How to collect the data

Every time NEXT is pressed, record for each participant still waiting: the predicted wait, the range \([L, U]\) and the timestamp. When that participant is later called, the actual wait \(y\) is known. These (prediction, actual) pairs need no participant identity, and one real session at a college office produces hundreds of them.

You could compare:

```text
Static estimate
      vs
Moving average
      vs
EWMA
      vs
ML model
```

This would make the "AI" part academically meaningful rather than simply adding an LLM API.

---

# 23. Suggested Technology Stack

## Applications

- **Native Mobile Applications:**
  - Native QPeer Provider App
  - Lightweight Native QPeer Participant App
  - *Native framework / language choice: TBD* (e.g., cross-platform native or platform-native, keeping the participant footprint minimal)
- **Hardware & Device Capabilities:**
  - QR-code scanner & generator (static queue discovery QR)
  - BLE peripheral mode / advertising capability on the provider device (presence beacon)
  - BLE scanning and GATT client capability on the participant device (proximity verification handshake)

## Cryptography & Key Storage

- Native secure key storage (e.g., iOS Keychain / Android Keystore / Secure Enclave)
- Device-level cryptographic primitives:
  - Ed25519 or ECDSA anonymous identity keypair generation
  - Hashing (SHA-256)
  - Ephemeral proximity challenge/response signature verification

## Serverless Backend

Candidate:

- Cloudflare Workers
- Cloudflare Durable Objects (single-threaded coordinator per queue instance, in-memory state, Fenwick tree indexing, alarms)

## Optional Storage

Only if needed later:

- Cloudflare D1
- Another managed relational/NoSQL database

## Realtime Communication

- WebSockets through the queue's serverless object (Durable Object)
- Proximity-based subscription/notification strategy

## Notifications

- Native OS push notifications (APNs for iOS, FCM for Android) for reliable background alerting when approaching turn
- Local OS notifications triggered upon arrival or proximity transitions
- *Note:* Notifications serve as a convenience layer; server-side queue position remains authoritative regardless of push receipt.

---

# 24. Privacy Principles

The project should follow data minimization by design.

### Collect as little as possible

Prefer:

```text
Anonymous participant ID
Queue ID
Position
Notification preference
```

instead of:

```text
Name
Phone
Email
Address
```

### Ephemeral data

Queues automatically expire.

### No unnecessary history

Do not retain participant information after the queue is finished.

### Public queue state is acceptable

The queue itself can expose:

```text
Current: #42
Waiting: 13
```

while individual participants remain represented by anonymous cryptographic identities.

---

# 24B. Emergency Queuing & Misuse Prevention

The baseline model utilized strict chronological ordering. The system is updated to handle triage and out-of-band priorities without compromising the privacy-first design, breaking the Fenwick-tree indexing, or opening the system to unchecked nepotism.

* **Dedicated Lanes:** Instead of assigning arbitrary fractional indices (e.g., `#47.5`) that break integer-indexed Fenwick trees, triage participants receive a dedicated triage identifier (`T1`, `T2`, …) and paid Priority Pass holders a priority identifier (`P1`, `P2`, …).
  ```text
  Triage Lane (Head of Service, free, staff only)
  T1
  T2
  ...

  Priority Lane (paid, mixed in at 1 per N regular calls)
  P1
  P2
  ...

  Regular Queue (Fenwick Tree Indexed)
  #47
  #48
  #49
  ...
  ```
* **Queue Order & People-Ahead Calculations:**
  - Triage participants are served before everyone, in triage order.
  - Paid priority participants are **not** served before the whole regular queue. A credit counter decides: +1 per regular call (capped at N), −N per priority call. The priority head is called only when it is due. N is set by each business.
  - Active regular participants retain their sequential, immutable integer tokens (`#n`) tracked via the Fenwick tree.
  - For any regular participant `#m`:
    $$\text{people\_ahead}(\#m) = \text{triage ahead} + \text{prefix\_sum}(m - 1) + \text{expected priority calls (a range)}$$
  - For any priority participant $\#Pk$:
    $$\text{people\_ahead}(\#Pk) = \text{triage ahead} + \text{earlier priority ahead} + \text{regular calls before } \#Pk \text{ is due}$$
  - No existing participant records require renumbering or array shifts, preserving both $O(\log n)$ operations and display-friendly tokens.
* **Business-Set Limits:** Triage inserts have a daily cap that the business sets (default 5 per day). The paid priority ratio N is also a business setting; QPeer sets no platform cap. Public ratings, split by regular and priority customers, are the check on unfair use.
* **Public Transparency:** When a triage token is inserted, all actively waiting participants receive an in-app banner ("Emergency / Triage Token Inserted: T1"), keeping counter staff publicly accountable to the waiting crowd. When the paid lane is on, everyone sees "Priority lane on · 1 in N".
* **Cross-System Auditing:** Because QPeer intentionally avoids collecting permanent user databases or identity data, internal audits of priority misuse rely on cross-referencing QPeer's timestamped priority logs with the facility's primary service database (e.g., hospital admission records) to verify the legitimacy of the triage.
* **The "Red Channel" Bypass:** For true emergencies, the patient bypasses QPeer entirely. The clerk selects "Pause Queue", which temporarily halts the adaptive ETA algorithm and alerts waiting users that the counter is paused for an emergency, requiring zero digital tokens.

---

# 25. Updated Threat Model

The primary threat addressed is:

```text
Attacker
    ↓
Obtains public QR / queue URL remotely (e.g. via WhatsApp)
    ↓
Attempts to join queue
    ↓
Cannot establish BLE proximity with provider
    ↓
Rejected (no queue token allocated)
```

The system is not intended to guarantee:
- Exact physical distance (e.g., distinguishing 2 meters from 5 meters)
- Exact position inside a specific room
- Protection against sophisticated, multi-device physical BLE relay attacks

The intended security property is specifically:
> **Remote QR/URL possession alone must not be sufficient to obtain a queue position.**

---

# 26. Updated Product Philosophy

> **No account. No phone number. No identity database. Scan, verify proximity, get a queue position, walk away, and return when needed. Participants without a compatible device or connectivity can still join through a provider-assisted physical credential.**

The technical philosophy remains:
> **Keep the queue itself server-side and simple. Use the provider device for physical admission, use cryptography for credential ownership, and use the lightweight participant app for the enhanced remote waiting experience.**

---

# 27. High-Level System Architecture

```text
                         QPeer Provider App
                                │
                   ┌────────────┴────────────┐
                   │                         │
             Queue Management          BLE Proximity
             NEXT / PAUSE / etc.       Provider Identity
                   │                         │
                   └────────────┬────────────┘
                                │
                         Physical Location
                                │
                           Static QR (qpeer://queue/<id>)
                                │
                                ▼
                     Participant QPeer App
                                │
                           Scan QR
                                │
                       BLE Discovery
                                │
                    Cryptographic Proof
                                │
                                ▼
                         Queue Object (Durable Object)
                                │
                         Atomic JOIN
                                │
                                ▼
                           Queue #47
                                │
                             Leave
                                │
                    Live State / ETA / Push
                                │
                             Return
```

Manual fallback for offline/non-smartphone participants:

```text
Participant cannot use digital flow
                │
                ▼
          Provider App
                │
          + Add Person
                │
                ▼
       Server allocates #47
                │
                ▼
       #47 + Claim Credential (829461)
                │
                ▼
       Physical participation (or later convert to digital via app)
```

---

# 28. Architectural Definition

> **QPeer is a privacy-preserving virtual queue with a native provider application, a lightweight native participant application for secure proximity-based admission and remote queue monitoring, and a provider-assisted physical fallback for participants without compatible devices or connectivity.**
