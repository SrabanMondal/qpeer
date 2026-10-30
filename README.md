# Qpeer

Qpeer is a live queue map and queue marketplace. Customers find a business on a map, see the live wait, and join its queue: free in person (walk-in, with a GPS check), or paid from home (remote reservation). A business can also sell a Priority Pass that the queue engine serves 1 in N. Staff run the queue from a console on their phone.

Version 1 is a working demo for Android, with Razorpay in test mode. The demo city is Jammu.

## Contents

- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [First-time setup](#first-time-setup)
- [Run the API locally](#run-the-api-locally)
- [Run the mobile app](#run-the-mobile-app)
- [Checks and tests](#checks-and-tests)
- [Deploy the API](#deploy-the-api)
- [Load test](#load-test)
- [Documentation](#documentation)
- [Conventions](#conventions)

## Stack

| Part | Technology |
|---|---|
| Mobile app | Expo SDK 57, React Native 0.86, Expo Router, TanStack Query (`apps/mobile`) |
| API | Cloudflare Workers + Hono (`apps/api`) |
| Live queue | One SQLite-backed Durable Object per queue (`QueueDO`), WebSocket Hibernation |
| Database | Cloudflare D1 with Drizzle ORM |
| Shared contracts | zod schemas and pure helpers (`packages/shared`) |
| Sign-in | Firebase Authentication (anonymous, Google, phone) |
| Maps | Mapbox (`@rnmapbox/maps`) |
| Push alerts | Expo Push via FCM |
| Payments | Razorpay (test mode) |
| Builds | EAS Build (cloud), no Android Studio needed |
| Lint and format | Biome |

## Repository layout

```
apps/
  api/            Cloudflare Worker: routes, QueueDO, D1 migrations, tests
  mobile/         Expo app (Android)
packages/
  shared/         zod contracts and helpers used by both apps
scripts/
  loadtest/       simulated-users load and correctness test
  ticket-keys/    key generator for signed offline tickets
docs/             design docs, UI guide, requirements checklist
docs/runbook/     incident log: every problem found and how it was fixed
NOTES.md          current status and next steps
```

## Prerequisites

- Node.js 24 and npm 12 (the repo uses npm workspaces).
- A Cloudflare account (the free plan is enough) and `npx wrangler login`.
- A Firebase project with Authentication enabled (Anonymous, Google, Phone).
- A Mapbox account for a public access token (`pk.…`).
- An Expo account and `npx eas-cli login` for app builds.
- A Razorpay account in test mode (only for payments).
- An Android phone with USB debugging, and `adb` on your PATH, to run the dev build.

## First-time setup

1. Clone the repository and install the dependencies from the repository root:

   ```bash
   npm install
   ```

   npm 12 asks for approval of install scripts. Approve `esbuild` and `workerd` (the API needs them). The other packages do not need theirs.

2. Make sure the install works:

   ```bash
   npm run check
   ```

### Files you create (all gitignored)

Never commit these files. `.gitignore` already excludes them.

| File | What goes in it |
|---|---|
| `apps/api/.dev.vars` | Local API settings. Copy `apps/api/.dev.vars.example` and fill in `FIREBASE_PROJECT_ID`. |
| `apps/mobile/.env.local` | Copy `apps/mobile/.env.example`. Set `EXPO_PUBLIC_MAPBOX_TOKEN` and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. These values end up in the app, so put only public values here. |
| `apps/mobile/google-services.json` | Download it from the Firebase console (Project settings → Your apps → Android app `com.qpeer.app`). |
| `secrets/` | Private keys made by the scripts below, and your Razorpay test values. |

### Firebase

1. In the Firebase console, enable the Anonymous, Google and Phone sign-in providers.
2. Add an Android app with the package name `com.qpeer.app`.
3. Add the SHA-1 and SHA-256 fingerprints of the EAS signing key (`npx eas-cli credentials` in `apps/mobile`).
4. Download `google-services.json` again after you add the fingerprints.
5. Development builds only accept the Firebase **test phone numbers** (Authentication → Sign-in method → Phone).

### Cloudflare

The Worker config is `apps/api/wrangler.jsonc`. It has three environments: `dev`, `demo` and `loadtest`. Each one has its own Worker, D1 database and Durable Object binding.

1. If you use your own Cloudflare account, create the databases and put their ids in `wrangler.jsonc`:

   ```bash
   npx wrangler d1 create qpeer-dev
   ```

2. Apply the migrations (run this in `apps/api`):

   ```bash
   npx wrangler d1 migrations apply DB --env dev --remote
   ```

3. Make sure that nothing is pending:

   ```bash
   npx wrangler d1 migrations list DB --env dev --remote
   ```

Do not filter the output of these two commands. A filtered output once hid a pending migration (runbook INC-035).

### Secrets on the deployed Worker

Set each secret once per environment, from `apps/api`. Pipe the value from a gitignored file. Never paste a secret into a chat or a commit.

| Secret | Purpose |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay test mode. Without them the payment routes answer 500. |
| `TICKET_SIGNING_KEY` | Signs offline tickets. Make it with `npm run ticket-keys:gen -- --app` (repo root, Git Bash). This writes the private key to `secrets/ticket-signing-key.json` and the public key to `apps/mobile/src/constants/ticket-public-keys.json`. Commit only the public file. |
| `LOADTEST_JWKS` | `loadtest` environment only. The public key set from `npm run loadtest:gen-key`. |

Example (Git Bash, from `apps/api`):

```bash
npx wrangler secret put TICKET_SIGNING_KEY --env dev < ../../secrets/ticket-signing-key.json
```

### Razorpay webhook

In the Razorpay dashboard (test mode), add a webhook:

- URL: `https://<your dev Worker>/v1/webhooks/razorpay`
- Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`
- Events: `payment.authorized`, `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`

Set Payment Capture to automatic. The server also captures an authorized payment itself.

## Run the API locally

From `apps/api`:

```bash
npm run dev
```

Wrangler starts the Worker with a local D1 database and local Durable Objects. To apply the migrations to the local database first:

```bash
npx wrangler d1 migrations apply DB --local
```

The health check is `GET /v1/health`. It returns `{ ok, env, serverTime }`.

## Run the mobile app

The app uses native modules (Firebase, Mapbox, Razorpay), so it does not run in Expo Go. Use an EAS development build.

1. Build the development APK once (and again after any native change), from `apps/mobile`:

   ```bash
   npx eas-cli build --profile development --platform android
   ```

2. Install the APK on the phone, for example with `adb install -r <file>.apk`.

3. Start Metro in `apps/mobile`:

   ```bash
   npx expo start
   ```

4. Connect the phone over USB and forward the Metro port:

   ```bash
   adb reverse tcp:8081 tcp:8081
   ```

5. Open the Qpeer app on the phone and pick the Metro server.

JavaScript-only changes reload through Metro and need no new build. By default the app talks to the dev Worker (`EXPO_PUBLIC_API_URL`).

For a standalone APK that testers can install without a laptop:

```bash
npx eas-cli build --profile preview --platform android
```

Set `EXPO_PUBLIC_MAPBOX_TOKEN`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and the `GOOGLE_SERVICES_JSON` file variable in the EAS `preview` environment first.

### Testing tips

- Razorpay test payments: choose Netbanking, any bank, then **Success** or **Failure** on the test page.
- To test alerts with the app closed, use `adb shell am kill com.qpeer.app` (like a swipe-away). Never use `am force-stop`: Android then blocks push delivery to the app.
- To join a queue you must be within its join radius of the business pin (default 150 m).

## Checks and tests

From the repository root:

```bash
npm run check
```

This runs the TypeScript checks, Biome and all tests. The API tests run in the Workers runtime with local D1 and Durable Objects (`@cloudflare/vitest-plugin`).

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript in every workspace and in `scripts/` |
| `npm run lint` | Biome check |
| `npm run format` | Biome format |
| `npm run test` | API and shared tests |

Biome is the only linter. Do not run `expo lint`: it tries to install ESLint (runbook INC-019).

## Deploy the API

From `apps/api`. Apply the migrations first, then deploy:

```bash
npx wrangler deploy --env dev
```

The free Workers plan allows 5 cron triggers per account. Each environment registers one 15-minute trigger, which also runs the hourly and daily jobs (runbook INC-056).

## Load test

A Node simulator drives hundreds of virtual customers and staff against the `loadtest` Worker, then checks correctness invariants (unique numbers, queue order, people ahead, D1 against Durable Object state, pushes, payments fairness). Run it from Git Bash in the repository root (PowerShell drops the `--` arguments):

```bash
npm run loadtest:baseline
```

`npm run loadtest:full` runs 300 customers for 5 minutes. Reports go to `scripts/loadtest/reports/`. Runs over 10 minutes must run in the background, one at a time. Details: `docs/QPeer_v1_Backend_Architecture.md` §19.1.

## Documentation

| Document | Content |
|---|---|
| `NOTES.md` | Current status, plan and working rules. Read it first. |
| `docs/QPeer_v1_High_Level_Design.md` | Product design and queue rules |
| `docs/QPeer_v1_Backend_Architecture.md` | API, queue engine, payments, decisions (§23) |
| `docs/QPeer_v1_Requirements_Checklist.md` | Requirement IDs and status |
| `docs/QPeer_v1_UI_Design_Guide.md` | Screens, colours and components |
| `docs/runbook/README.md` | Incident log and lessons learned |

## Conventions

- Time is stored in epoch milliseconds. Money is stored in paise. The time zone is Asia/Kolkata.
- A user's location is never stored or logged. Only the distance and the accuracy of a check are kept.
- Non-members get 404, not 403, for business data.
- Commit messages are one line: `<type>: <message>`, for example `fix: refund paid tickets on close`.
