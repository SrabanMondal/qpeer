# QPeer System Updates: Edge Cases & Implementation Deltas

> **Status (October 2026): still valid.** The "Priority Lane" in Section 3 is the free **medical/triage priority** controlled by staff. It is separate from the paid **Priority Pass**, whose rules are still undecided (see `QPeer_Pitch_Problem_Solution_Impact.md` §5 and `QPeer_Platform_Architecture_and_Build_Plan.md` §3.4). Triage always comes before paid priority.
> Section 2 (static QR + BLE) is replaced by **static QR + a GPS check** as the default walk-in check, with BLE kept only as an optional strict mode for later (see the build plan, §3.2).

This document outlines the architectural and policy changes resolving the edge cases identified in the original QPeer specifications. It serves as a delta document overriding the baseline assumptions regarding missed turns, remote joining, hardware requirements, and strict FIFO queueing.

---

## 1. Missed Turns & Grace Period Handling

The original specification assumed a strict progression where missed turns were skipped. To prevent user frustration and front-desk arguments, a temporary holding state is introduced.

* **Updated State Machine:** The serverless state machine expands from `WAITING`, `CALLED`, and `EXPIRED` to include a `GRACE` state.
* **The Holding Queue:** If a participant is a no-show when called, the clerk selects "No Show". The participant is dropped from the active prefix sum calculation in the Fenwick Tree, allowing the line to advance instantly, and is moved to a "Late Arrivals" holding tray on the clerk's dashboard.
* **Automated Expiry:** A serverless alarm (e.g., Cloudflare Durable Object Alarm) starts a 10–15 minute countdown. If the user does not arrive before it fires, their token is permanently marked `EXPIRED`.
* **Fast-Track Readmission:** If the user arrives during the grace period, the clerk selects "Admit Late Arrival". The user is injected into the counter immediately following the currently active consultation, bypassing the remaining queue without restarting at the back.

```text
[ WAITING ] ──(Called)──> [ CALLED ] ──(No-Show)──> [ GRACE ] ──(Timer Expires)──> [ EXPIRED ]
                             │                         │
                         (Served)                 (Late Arrival)
                             │                         │
                             v                         v
                        [ COMPLETED ]         [ RE-ADMITTED (NEXT) ]
```

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

* **Priority Lane Insertion:** Clerks can utilize a "Priority Insert" function for legitimate urgencies (e.g., Medical Triage). Instead of fractional indices that break integer Fenwick trees, priority participants receive a dedicated Priority Lane token (`#P1`, `#P2`, etc.) served before regular integer tokens (`#47`, `#48`). The Fenwick tree continues to track active regular participants by integer number, and `people_ahead` for regular participants cleanly incorporates active priority participants without rewriting records or shifting array indices.
* **Systemic Quotas:** To prevent abuse, priority inserts are hard-capped by volume (e.g., max 3 per day, or 1 per 15 regular tokens).
* **Public Transparency:** When a priority token is inserted, all actively waiting participants receive an in-app banner ("Emergency / Triage Token Inserted: #P-1"), keeping counter staff publicly accountable to the waiting crowd.
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
