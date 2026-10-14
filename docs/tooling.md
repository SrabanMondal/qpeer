# QPeer v1: Tooling, Accounts and Setup

This document covers what we need to build QPeer v1 (see `QPeer_v1_High_Level_Design.md`) **efficiently, consistently and cleanly**. It lists the accounts you create, the tools on this machine, the phone setup, the daily development loop, how I debug, and the repo conventions that keep the AI engines (agy, opencode) and me working consistently.

**Rule of thumb:** you handle **logins, accounts and anything involving a card**. I handle **installs, code, builds, tests and debugging**. Secrets go into gitignored files, **never into chat**.

---

## 1. Summary

| Category | Needed | Status |
|---|---|---|
| Accounts | Cloudflare, Expo, Firebase, Mapbox (no card), Razorpay (test mode), GitHub (optional) | You create (Section 2) |
| Already on this machine | Node 24, npm, git, GitHub CLI, uv/Python, pnpm | ✅ |
| Install once (machine) | **scrcpy** (includes **adb**) | Required |
| Install once (optional) | cloudflared (webhook tunnel), JDK 17 + Maestro (scripted UI tests) | Later, if useful |
| Per project (no global install) | wrangler, eas-cli, drizzle-kit, Biome, Vitest | I install them as project dependencies |
| Devices | **2 Android phones** (one as the business, one as the customer). One phone is enough for most building; the second is needed for live-update and alert tests and the demo itself. | You provide |
| Not needed | Android Studio, Xcode, a Mac, Flutter, any paid plan | — |

---

## 2. Accounts You Create

Do these once. For each, the table says what to switch on, and **what I need and where it goes**.

### 2.1 Cloudflare (free plan)

| Step | Details |
|---|---|
| Create account | Free plan is enough for v1 |
| What I need | Run **`npx wrangler login`** once in your own terminal (it opens a browser). Wrangler then works for me on this machine. |
| Created by me later | Workers `qpeer-api-dev` / `qpeer-api`, D1 databases `qpeer-dev` / `qpeer-demo`, secrets via `wrangler secret put` |

### 2.2 Expo (free plan)

| Step | Details |
|---|---|
| Create account | expo.dev |
| What I need | Run **`npx eas-cli login`** once in your terminal. Builds and credentials then work from this machine. |
| Note | The free plan has a monthly limit on cloud builds. We only rebuild when native parts change; normal code changes reload instantly without a build (Section 4). |

### 2.3 Firebase (Spark / free plan)

| Step | Details |
|---|---|
| Create project | Name it `qpeer` |
| Add Android app | Use the **package name** we pick (open item in the HLD, for example `com.qpeer.app`). Add the **SHA-1 and SHA-256 fingerprints** of the EAS signing key. I'll get these for you with `eas credentials` after the first build. |
| Authentication → Sign-in methods | Enable **Anonymous**, **Google**, **Phone** |
| Phone → test numbers | Add 3–4 **test phone numbers with fixed codes** (for example `+91 99999 00001` → `123456`). These work for free with no real SMS. |
| Cloud Messaging | Create the **FCM v1 service account key** and upload it to Expo (`eas credentials`). I can do the upload if you put the JSON file in the gitignored `secrets/` folder. |
| What I need | `google-services.json` placed in `apps/mobile/` (gitignored) |
| Cost note | Real SMS OTP costs money and may need the pay-as-you-go plan. **v1 uses test numbers and Google Sign-In only**, so it stays free. |

### 2.4 Mapbox (maps)

| Step | Details |
|---|---|
| Create account | account.mapbox.com → choose **"Start without a credit card"** → verify email. You get a **trial public token** (starts with `pk.`). |
| Limits | The trial covers mobile maps within limits that can change. Mapbox sends a console alert and an email when you hit them, and **nothing is charged without a card**. Demo use is far below them. |
| Token scope | The default public token is enough. Optionally create a separate public token named `qpeer-dev` so it can be rotated without touching anything else. |
| Download token (only if asked) | Older Android SDK versions required a **secret** token with the `DOWNLOADS:READ` scope to download the SDK during builds. The current docs don't ask for it. If an EAS build fails asking for one, create it, and I'll store it as an EAS secret. |
| Before a real launch | Add a card to unlock the free tier (25,000 monthly active users free) and rotate the token |
| What I need | The public token in `apps/mobile/.env.local` (gitignored) |

**Google Cloud is no longer needed for maps.** The Google Cloud project that Firebase creates for you stays as it is, with no billing.

### 2.5 Razorpay (test mode)

| Step | Details |
|---|---|
| Create account | Test mode works immediately. **No KYC needed for test mode.** |
| Test API keys | Dashboard → test mode → API keys. **Key ID** (public, goes in the app config) and **Key Secret** (Worker only). |
| Webhook | URL: `https://qpeer-api-dev.<your-subdomain>.workers.dev/v1/webhooks/razorpay`. Events: `payment.captured`, `payment.failed`, `refund.processed`. Set a **webhook secret**. |
| Payment capture | Turn on **automatic capture** in settings |
| Route (split payments) | Check whether it can be enabled in test mode. If not, the split lives in our ledger only (already planned). |
| What I need | Key ID, Key Secret and Webhook Secret in `apps/api/.dev.vars` (gitignored). I copy them to the deployed Worker with `wrangler secret put`. |

### 2.6 GitHub (optional, recommended)

A **private repo** gives you an off-machine backup and free CI (Section 6.3). Engines never push; you (or I, when you ask) push merged work.

---

## 3. Machine Tools

### 3.1 Install once

| Tool | Why | Install |
|---|---|---|
| **scrcpy** (bundles **adb**) | `adb` lets me install builds, read phone logs, **take screenshots I can look at**, and send taps. scrcpy lets *you* see and control the phone on your PC screen and record demos. | `winget install Genymobile.scrcpy` |

That is the only required install. Android Studio is **not** needed: Expo builds in the cloud, and adb is all we need on the PC.

### 3.2 Optional, install when needed

| Tool | When | Install |
|---|---|---|
| **cloudflared** | To let Razorpay webhooks reach a Worker running **locally** (a quick tunnel, no account). The deployed `dev` Worker usually makes this unnecessary. | `winget install Cloudflare.cloudflared` |
| **JDK 17** + **Maestro** | Scripted UI tests on the real phone ("tap Join, expect token"). Useful from Step 2 to re-check the demo script automatically. | `winget install EclipseAdoptium.Temurin.17.JDK`, then Maestro from its GitHub releases |

### 3.3 Project tools (installed by me, per project)

`wrangler`, `eas-cli`, `drizzle-kit`, `@biomejs/biome`, `vitest`, `@cloudflare/vitest-pool-workers`, `tsx`. They are dev dependencies, run through `npx`, with versions pinned in the lockfile. Nothing global, so every engine and every machine uses the same versions.

### 3.4 Repo location

Use a **short path**, for example `C:\dev\qpeer` or `G:\dev\qpeer`. Deep Windows paths break some Android and Node tooling. (Turning on Windows long-path support also helps, but that's a system setting for you to change if you want it.)

---

## 4. Phone Setup and the Development Loop

### 4.1 Phone setup (once per phone)

1. Settings → About phone → tap **Build number** 7 times → **Developer options** appear.
2. In Developer options, enable **USB debugging** (and **Wireless debugging** on Android 11+ if you'd rather not use a cable).
3. Connect by USB the first time and accept the "Allow USB debugging" prompt.
4. Keep the phone on the **same Wi-Fi** as the PC.
5. Sign in to a Google account on the phone (for Google Sign-In testing).
6. Allow QPeer notifications, and set QPeer's battery usage to **"Unrestricted"** (Xiaomi, Oppo, Vivo and Realme phones especially).

### 4.2 Daily loop

```text
Native change (new native library, app.json, permissions)?
   └─ yes → EAS cloud development build (~10–20 min) → install APK with adb
   └─ no  → Metro dev server on the PC → app reloads instantly on the phone

Backend change?
   └─ npm test (local Durable Objects + D1) → wrangler deploy --env dev → phone uses dev Worker
```

- **Metro** (the JavaScript dev server) runs on the PC, and the development build on the phone connects to it over Wi-Fi. Most work happens here, with no rebuilds.
- **Development builds** are rebuilt only when native parts change. That keeps us well inside the free EAS build limit.
- The phone talks to the **deployed `dev` Worker**, because Razorpay webhooks and the phone both need a public URL. Local `wrangler dev` is for tests and fast backend work.

---

## 5. Debugging Setup

Most of these are what let me debug **by myself** instead of asking you "what do you see?".

| What | Tool | Who uses it |
|---|---|---|
| **See the phone screen** | `adb exec-out screencap -p > shot.png`, then I open the image | Me |
| **Watch / control the phone live** | scrcpy window on the PC (also records demo videos) | You |
| **Tap and type on the phone** | `adb shell input tap/text`, or Maestro flows | Me |
| **App logs** | Metro terminal output (JS logs and errors) | Me |
| **Native crashes** | `adb logcat` filtered to the app (crashes Metro can't show) | Me |
| **JS debugger** | React Native DevTools (press `j` in Metro, opens in Chrome) | You, when stepping through code helps |
| **Worker logs** | `wrangler tail --env dev` (live logs from the deployed API) | Me |
| **Database** | `wrangler d1 execute qpeer-dev --command "…"`, Drizzle Studio for browsing | Me / you |
| **Payments** | Razorpay test dashboard: payments, refunds, **webhook delivery logs** | Both |
| **Push alerts** | Expo push receipts API, Expo's push test tool | Me |
| **Logins** | Firebase console → Authentication → Users | You |
| **Live queue simulation** | `scripts/simulate` drives a queue without a crowd of phones | Me |

**Logging convention:** the API logs one structured JSON line per request with a request ID, user ID, queue ID and result. The app shows the request ID on error screens, so one ID lets me trace a problem across phone, Worker and database.

**Git Bash trap (from your global notes):** `adb shell` commands with phone paths like `/sdcard/...` get rewritten into Windows paths by Git Bash. I'll prefix them with `MSYS_NO_PATHCONV=1` or run them from PowerShell.

---

## 6. Repo Conventions That Keep the Work Consistent

These make the engines' output predictable and my reviews fast.

### 6.1 Files in the repo

| File | Purpose |
|---|---|
| `CLAUDE.md` + `AGENTS.md` | Short conventions: structure, commands, coding rules, "definition of done". Every engine brief points to it. |
| `NOTES.md` | Build progress, decisions and handoff notes between sessions |
| `.dev.vars.example`, `.env.example` | Templates listing every setting and secret (no real values) |
| `.orch/` (gitignored) | Engine run files, reference material, test data |
| `secrets/` (gitignored) | Files like the FCM service account JSON |

### 6.2 Rules

- **One check command:** `npm run check` = typecheck + Biome lint/format + all tests. A step isn't done until it passes.
- **Shared contracts:** request and response shapes live once in `packages/shared` as zod schemas. The API validates with them and the app's types come from them, so the app and API can't drift apart.
- **Pinned versions:** a fixed Expo SDK version and a committed lockfile. **I install dependencies before each engine brief**, because the engines can't download packages.
- **Small steps:** each build step from the HLD goes on its own branch (`agy/<slug>` or `oc/<slug>`), is merged with `--no-ff` after review, and is never pushed by an engine.
- **Tests first for risky logic:** queue order, concurrent joins, payment idempotency and the grace timer get integration tests before the screens that use them.
- **Blind review:** after each step, opencode reviews the change against the HLD and fixes what it finds, then I check it on the phone.

### 6.3 CI (optional, needs GitHub)

A GitHub Action runs `npm run check` on every push. It's free for small private repos and catches anything that only works on this machine.

---

## 7. Free-Tier Limits to Keep in Mind

Check current numbers on each provider's pricing page. Demo usage should be far below all of them.

| Service | What to watch |
|---|---|
| Cloudflare Workers / D1 / Durable Objects (free) | Daily request limit and D1 read/write limits. Fine for a demo. The simulator runs at a modest rate. |
| EAS Build (free) | Monthly build count. Rebuild only for native changes. |
| Firebase Spark | Anonymous and Google sign-in are free. Test phone numbers are free. **Real SMS is not used in v1.** |
| Mapbox (trial, no card) | Trial limits on mobile maps. You get an alert and email when reached, and no charges without a card. |
| Razorpay test mode | Free, no real money |

---

## 8. Checklist: What I Need From You Before Step 0

- [ ] **Decide:** Android package name, app name, demo city, repo path (see HLD §13)
- [ ] **Install:** `winget install Genymobile.scrcpy`
- [ ] **Accounts:** Cloudflare, Expo, Firebase, Mapbox (no card), Razorpay test mode
- [ ] **Log in on this machine:** `npx wrangler login` and `npx eas-cli login` (in your own terminal)
- [ ] **Phones:** developer options + USB debugging on, connected once by USB, same Wi-Fi as the PC
- [ ] **After the first build** (I'll tell you when): add the SHA fingerprints to Firebase, then drop `google-services.json`, the Mapbox token and the Razorpay keys into the gitignored files I create

Everything else, including installs, project setup, builds, deploys, tests and debugging, is on my side.
