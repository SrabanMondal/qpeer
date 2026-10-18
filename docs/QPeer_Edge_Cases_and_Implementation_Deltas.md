# QPeer System Updates: Edge Cases & Implementation Deltas

> **Updated 2026-10-18.** Section 1 now has the decided missed-turn flow (GRACE → MISSED → one rejoin → EXPIRED). The "triage lane" in Section 3 is the free **medical/triage priority** controlled by staff. It is separate from the paid **Priority Pass**, decided 2026-10-18: a priority lane that the engine mixes in at "1 priority per N regulars" (N set by each business), see `QPeer_v1_High_Level_Design.md` §5.2. Triage always comes before paid priority.
> Section 2 (static QR + BLE) is replaced by **static QR + a GPS check** as the default walk-in check, with BLE kept only as an optional strict mode for later (see the build plan, §3.2). v1 counts people ahead with an indexed SQL `COUNT` instead of the Fenwick tree named below.

This document outlines the architectural and policy changes resolving the edge cases identified in the original QPeer specifications. It serves as a delta document overriding the baseline assumptions regarding missed turns, remote joining, hardware requirements, and strict FIFO queueing.

---

## 1. Missed Turns & Grace Period Handling

The original specification assumed a strict progression where missed turns were skipped. To prevent user frustration and front-desk arguments, a temporary holding state is introduced.

* **Updated State Machine:** The state machine expands from `WAITING`, `CALLED`, and `EXPIRED` to include `GRACE` and, since 2026-10-18, `MISSED`.
* **The Holding Queue:** If a participant is a no-show when called, the clerk selects "No Show". The participant drops out of the people-ahead count, the line advances at once, and the ticket moves to a "Late Arrivals" tray on the clerk's dashboard. Nobody else's people-ahead changes.
* **Grace countdown:** A Durable Object alarm starts the grace countdown (a business setting, default 10 min). The participant gets a "you were called, come now" alert, and the ticket shows a large "Come now — m:ss left" countdown.
* **Fast-Track Readmission:** If the user arrives during the grace period, the clerk selects "Admit". The user is served right after the current person, without restarting at the back.
* **Missed, not expired:** When the grace timer fires, the ticket becomes `MISSED`, not `EXPIRED`. It is out of the line. One `missed` alert says "You missed your turn. Tap I'm here when you arrive."
* **One rejoin:** The participant taps **I'm here**. The app runs the same GPS check as a walk-in join (location never stored, fake locations rejected). This works once per ticket. Within the business's late window (default 15 min), the ticket goes back by about `rejoinDelayMin` minutes of service (default 15): behind ceil(rejoinDelayMin ÷ average service time) waiting people, at least 1. A clinic at 3 min per person → behind 5; a salon at 30 min per person → behind 1. After the late window → the end of the line.
* **Expiry:** A second miss, or no rejoin before the queue closes → `EXPIRED`. A MISSED ticket never carries over to the next day. Free walk-ins get one no-show strike (3 in 30 days block free joins for 7 days). Paid tickets get no strike: losing the fee is the penalty.

```text
[ WAITING ] ──(Called)──> [ CALLED ] ──(No-Show)──> [ GRACE ] ──(Timer)──> [ MISSED ] ──(Close / 2nd miss)──> [ EXPIRED ]
                             │                         │                       │
                         (Served)                  (Admit)              ("I'm here", once)
                             │                         │                       │
                             v                         v                       v
                        [ SERVED ]           [ CALLED, served next ]   [ WAITING, moved back ]
```

**Missed-turn edge cases (decided 2026-10-18):**

| Case | What happens |
|---|---|
| Comes back late on purpose | One rejoin, moved back by the rejoin delay; after the late window, to the end. A second miss expires the ticket. |
| Taps "I'm here" from home | Rejected by the GPS check (150 m default radius). |
| Fewer people waiting than the rejoin delay needs | To the end of the line. |
| Two people rejoin at the same time | Same rule for each, in the order the server received them. |
| Staff mark someone No-show by mistake | Grace protects them; every action is logged with its time. |
| Phone dead after MISSED | *Proposed (R2, awaiting the owner):* every ticket shows a 4-character check code under its number ("#14 · K7P2"). Staff "Rejoin for customer" needs the number + check code, with the same once-only and position rule. If the person knows neither, staff serve them as a new walk-in. Staff never move a ticket by choice. |

---

## 2. Physical Presence Verification (Static QR + BLE Proximity)

The architecture replaces rotating QR codes and specialized NFC hardware with:

> **Static QR for queue discovery + BLE proximity for admission authorization.**

* **The Static QR:** The physical QR code at the venue only identifies the queue (`qpeer://queue/<queue-id>`). Possessing the QR code or URL alone is never sufficient to obtain a token.
* **Provider Phone as BLE Anchor:** The provider operates the queue using the QPeer Provider App, which simultaneously acts as the local BLE proximity beacon in the background. The provider does not need to hold their phone up to display a QR.
* **Admission Handshake:** When the participant scans the static QR using the lightweight QPeer Participant App, the app discovers the nearby provider phone via BLE and executes a cryptographic challenge/response verified by the server.
* **Security Goal:** Defeats remote queue inflation where a QR screenshot is shared over messaging apps (a remote person has no nearby provider BLE signal and is rejected).
* **Admission-Only BLE:** BLE is only required during admission. Once the queue token is allocated, the participant can walk away; BLE is no longer needed.

---

## 3. Emergency Queuing & Misuse Prevention

The baseline model utilized strict chronological ordering. The system is updated to handle triage and out-of-band priorities without compromising the privacy-first design or opening the system to unchecked nepotism.

* **Triage Insertion:** Clerks can use a "Triage" insert for legitimate urgencies (e.g., medical triage). Triage participants receive their own token series (`T1`, `T2`, …) and are served before everyone else, including the paid priority lane (`P1`, `P2`, …) and regular tokens (`#47`, `#48`). Each class keeps its own sort range, so `people_ahead` for every participant includes the triage tokens ahead without rewriting records.
* **Triage Daily Cap:** To prevent abuse, triage inserts are capped per day. The cap is a business setting (`triageDailyCap`, default 5). This cap is for free triage only. Paid priority follows a different rule: the 1-in-N credit counter, where Next calls a priority holder only after N regular calls (N set by the business).
* **Public Transparency:** When a triage token is inserted, all actively waiting participants receive an in-app banner ("Emergency / Triage Token Inserted: T1"), keeping counter staff publicly accountable to the waiting crowd. The paid lane is shown too: "Priority lane on · 1 in N".
* **Cross-System Auditing:** Because QPeer intentionally avoids collecting permanent user databases or identity data, internal audits of priority misuse rely on cross-referencing QPeer's timestamped priority logs with the facility's primary service database (e.g., hospital admission records) to verify the legitimacy of the triage.
* **The "Red Channel" Bypass:** For true emergencies, the patient bypasses QPeer entirely. The clerk selects "Pause Queue", which temporarily halts the adaptive ETA algorithm and alerts waiting users that the counter is paused for an emergency, requiring zero digital tokens.

---

## 4. Universal Manual Join Fallback & Claim Codes

QPeer never makes a modern smartphone, active internet connection, or participant app a prerequisite for receiving service.

* **Provider-Assisted Manual Join:** If a participant cannot use the digital flow (button phone, no internet, no Bluetooth, or no smartphone), the provider taps **+ Add Person** in the Provider App.
* **Single Unified Queue:** The server allocates the next sequential position in the exact same queue shared with digital participants (e.g., #45 digital, #46 digital, #47 manual, #48 digital).
* **Physical Bearer Credential:** The provider gives the participant a physical slip with their queue number and a 6-digit claim code (e.g., `#47`, Claim code: `829461`).
* **Accessibility Inclusivity:** The provider acts as the connectivity bridge for offline participants, ensuring zero technical exclusion.

---

## 5. Manual → Digital Conversion

A manually added participant can later install the QPeer participant app (or have a family member assist them) and bind their queue position:

1. Open QPeer participant app.
2. Enter the queue ID and 6-digit claim code.
3. Server validates the claim code, generates an anonymous device keypair, and binds the key to the existing queue position.
4. The one-time claim code is invalidated.
5. The participant immediately receives live status, adaptive ETA, and push notifications without losing their place in line.
