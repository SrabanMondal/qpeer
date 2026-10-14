# QPeer — Architecture Update: Native Apps, Static QR & BLE Proximity Verification

> **Status (October 2026): BLE is now an optional "strict mode" for later, not the default.** Walk-ins are checked with **static QR + a forgiving GPS check** (default radius 150 m), and businesses that see abuse can switch on a **rotating QR on a screen**. BLE is built only if real abuse justifies the work. See `QPeer_Platform_Architecture_and_Build_Plan.md` §3.2.
> These parts are still valid regardless of the check used: the manual fallback, claim codes, manual-to-digital conversion, and the single shared queue (§10–17). The plan also uses **one app with a Customer mode and a Business mode** instead of two separate apps.

This document outlines the architectural decisions transitioning QPeer from a browser/PWA-first model to a native mobile architecture with BLE proximity-based admission and universal manual fallback.

---

## 1. Participant Architecture Changes

The participant is no longer assumed to use only a browser/PWA.

QPeer uses:

- **A native mobile app for the service provider.**
- **A lightweight native mobile app for participants** as the primary digital experience.
- **A provider-assisted manual fallback** for participants who cannot use the participant app.

The participant app remains intentionally small and focused on:

- QR scanning
- BLE proximity verification
- Anonymous cryptographic identity/key storage
- Queue credential storage
- Queue status
- Estimated waiting time
- Notifications

The participant app is not a feature-heavy or bloated application.

---

## 2. Service Provider App

The service provider must use the QPeer mobile app.

The provider app is responsible for:

- Creating queues
- Displaying/managing queue state
- `NEXT`
- `PAUSE`
- `SKIP`
- Priority handling
- Other queue-management operations

The same provider phone also acts as the local BLE proximity device.

The provider does not need to perform any additional action for participant admission; the provider uses the app normally while QPeer handles BLE discovery in the background.

---

## 3. Replace Rotating QR With Static QR + Proximity Verification

The architecture replaces rotating QR codes with:

> **Static QR for queue discovery + BLE proximity for admission authorization.**

The QR only identifies the queue:

```text
qpeer://queue/<queue-id>
```

Possessing the QR code or URL alone is **not** sufficient to obtain a queue token.

Therefore, the physical QR can be:

- Printed
- Laminated
- Displayed on a static screen
- Displayed on an inexpensive e-paper device
- Displayed by dedicated hardware standees

A rotating QR is no longer required.

---

## 4. Provider Phone as the Proximity Anchor

The provider's phone operates the queue and simultaneously acts as the QPeer BLE proximity beacon.

```text
Provider Phone
├── Queue management
│   ├── NEXT
│   ├── PAUSE
│   ├── SKIP
│   └── Priority operations
│
└── BLE proximity functionality (Beacon / Peripheral)
```

The provider does not need to hold the phone up to display a QR. The phone remains available for normal queue management.

---

## 5. New Participant Admission Flow

The digital participant flow:

```text
Scan QR
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

BLE serves as the proximity/discovery mechanism, not the cryptographic trust anchor by itself. The server verifies a cryptographic proof associated with the authorized provider session.

---

## 6. Actual Physical-Presence Security Goal

The actual security objective is:

> **Prevent a remote person from obtaining a queue position using only a publicly shared QR code or queue URL.**

Desired behavior:

```text
Remote person
    ↓
Obtains QR screenshot
    ↓
Scans QR
    ↓
No nearby provider detected via BLE
    ↓
Cannot obtain token
```

Whereas:

```text
Person near service location
    ↓
Scans QR
    ↓
Detects provider through BLE
    ↓
Cryptographic verification
    ↓
Receives queue token
```

QPeer is not attempting to provide precise indoor positioning or exact physical-distance proofs; it specifically defeats remote queue hoarding and automated bot joins.

---

## 7. Static QR Hardware Becomes Sufficient

Because the QR no longer rotates, the physical queue display does not need dynamic screens.

Possible implementations:

- Printed QR poster
- Laminated QR card / standee
- Static display monitor
- E-paper display
- Low-cost dedicated hardware

The provider's phone handles queue management and proximity verification rather than QR display.

---

## 8. Participant App Is the Primary Digital Path

The preferred digital flow:

```text
Scan QR
    ↓
QPeer app
    ↓
BLE proximity verification
    ↓
Join queue
```

The participant app is lightweight, privacy-focused, and dedicated to the queue experience.

---

## 9. BLE Is Required Only During Admission

BLE is only needed to establish the participant's proximity to the provider when joining.

After receiving a valid queue credential:

```text
Join
    ↓
Receive #47
    ↓
Leave physical location
    ↓
BLE no longer required
    ↓
Queue continues server-side
    ↓
Receive live status / notification
    ↓
Return when needed
```

The participant does not need to remain near the provider. They can walk away, run errands, or rest, and return when their turn approaches.

---

## 10. Universal Manual Join Fallback

QPeer does not make a smartphone, internet connection, or participant app a prerequisite for receiving service.

If a participant cannot use the digital flow, the provider adds them manually:

```text
Provider App
    ↓
+ Add Person
    ↓
Server allocates next queue position
    ↓
Provider gives participant their queue credential
```

The manual participant becomes part of the exact same queue sequence as digital participants:

```text
#45 → digital participant
#46 → digital participant
#47 → manual participant
#48 → digital participant
#49 → manual participant
```

There is only **one single queue**.

---

## 11. Manual Participant Credential

When the provider manually adds a participant, QPeer generates a physical/bearer credential:

```text
Queue number: #47
Claim code: 829461
```

The server stores a secure hash of the claim secret. The manual credential is a physical/bearer credential, differing from the app's cryptographic private key.

---

## 12. Manual → Digital Conversion

A manually added participant who later installs the QPeer participant app can claim their queue position:

```text
Manual participant
    ↓
Install QPeer app
    ↓
Enter queue information + claim code
    ↓
Verify manual credential with server
    ↓
Generate device key
    ↓
Bind key to existing queue position
    ↓
Invalidate one-time claim credential
    ↓
Continue using normal digital QPeer features
```

The participant upgrades to live notifications and status tracking without losing their position.

---

## 13. Digital and Manual Participants Share the Same Queue

No separate queues exist. The server-side queue object remains the single source of truth. The numbering and ordering remain identical; only authentication and notification channels differ.

---

## 14. Support for Participants Without Internet

If a participant has no internet, the provider acts as the connectivity bridge:

```text
Participant ──> Provider ──> QPeer Server ──> Queue position allocated
```

The provider issues the physical token and claim credential.

---

## 15. Support for Participants Without Smartphones

Button phones, incompatible phones, or individuals without phones are supported via the provider-assisted manual flow. The digital experience is an enhancement, not a barrier to entry.

---

## 16. Support for Participants Without Bluetooth

If a participant's device lacks functional BLE, they use the provider-assisted manual path:

```text
Cannot use BLE ──> Provider [+ Add Person] ──> Queue position + manual credential
```

---

## 17. Notification Is a Convenience Layer

The authoritative state remains the server-side queue object:

- Notification delivered $\rightarrow$ Good
- Notification delayed $\rightarrow$ Queue still valid
- Notification missed $\rightarrow$ Participant reopens QPeer app and retrieves current state

---

## 18. Participant Cryptographic Identity

The participant key represents an:

> **Anonymous device/queue credential** (not proof of one unique human).

Used for:
- Anonymous authentication
- Queue credential ownership
- Secure participant access
- Persistent queue identity on the device

Preserves privacy without collecting names, phone numbers, or email addresses.

---

## 19. Updated Threat Model

The primary threat:
- Attacker obtains public QR / queue URL remotely $\rightarrow$ Attempts to join $\rightarrow$ Cannot establish BLE proximity with provider $\rightarrow$ Rejected (no queue token).

Targeted security property:
> **Remote QR/URL possession alone must not be sufficient to obtain a queue position.**

---

## 20. Updated Product Philosophy

> **No account. No phone number. No identity database. Scan, verify proximity, get a queue position, walk away, and return when needed. Participants without a compatible device or connectivity can still join through a provider-assisted physical credential.**

---

## 21. High-Level Architecture

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
                           Static QR
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
                         Queue Object
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

---

## 22. Important Architectural Definition

> **QPeer is a privacy-preserving virtual queue with a native provider application, a lightweight native participant application for secure proximity-based admission and remote queue monitoring, and a provider-assisted physical fallback for participants without compatible devices or connectivity.**
