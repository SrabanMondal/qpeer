# QPeer Build Progress Notes

## Step 0: Foundations — Repo Tooling, Shared Package, and API Skeleton with Firebase Auth
- **Repo tooling**: Biome 2.x configured at repo root with recommended lint rules and 2-space formatting; `.gitattributes` for LF line endings; `tsconfig.base.json` with strict mode; `AGENTS.md` and `CLAUDE.md` documenting monorepo conventions.
- **Mobile workspace (`apps/mobile`)**: Expo SDK 57 app shell (template demo removed).
  - **Config**: `app.config.ts` (replaces `app.json`). Package `com.qpeer.app`, scheme `qpeer`. Plugins: expo-router, expo-splash-screen, `@react-native-firebase/app` (iOS `disableSPM`) + `/auth`, google-signin (Firebase variant, no options), expo-build-properties (iOS `useFrameworks: "static"` + `forceStaticLinking: [RNFBApp, RNFBAuth]`; no Android overrides needed), `@rnmapbox/maps`, expo-location (when-in-use text), expo-camera (no microphone / `RECORD_AUDIO`), expo-notifications, expo-dev-client. `android.googleServicesFile` = `$GOOGLE_SERVICES_JSON` (EAS file env var) or the gitignored `./google-services.json`.
  - **EAS**: `eas.json` profiles `development` (dev client, internal APK), `preview` (internal APK), `production`. Both non-production profiles set `EXPO_PUBLIC_API_URL` to the dev Worker.
  - **TODO**: production API URL is not decided yet. Set `EXPO_PUBLIC_API_URL` on the `production` profile (or EAS `production` environment) once the `qpeer-api` demo Worker exists.
  - **Env vars** (see `apps/mobile/.env.example`; local values go in gitignored `.env.local`): `EXPO_PUBLIC_API_URL` (defaults to the dev Worker), `EXPO_PUBLIC_MAPBOX_TOKEN` (public `pk.` token), `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. Read once and validated with zod in `src/config.ts`. For EAS builds, the Mapbox token and Google web client id must also be set as EAS environment variables (they are not in `eas.json`).
  - **Auth** (`src/lib/auth.tsx`): modular RNFirebase API. Anonymous sign-in at launch and after sign-out (IDN-01, IDN-07); Google and phone (two-step) upgrade with `linkWithCredential`, falling back to `signInWithCredential` on `auth/credential-already-in-use` (`TODO(IDN-05)`); ID token force-refreshed after every link/sign-in. In `__DEV__`, `auth.settings.appVerificationDisabledForTesting = true`, so only Firebase **test phone numbers** work in dev builds.
  - **API** (`src/lib/api.ts`): `apiFetch(path, schema)` with Bearer Firebase ID token, zod validation, `ApiError { status, code, requestId }` (status 0 = network). `useMe()` (TanStack Query) keyed by uid + provider.
  - **Screens**: `index` (Firebase status + `/v1/me` with error/request ID/retry), `sign-in` (Google + phone OTP), `map-check` (Mapbox map on Jammu with one pin).
  - **Run with the dev build**: install the EAS `development` APK on the phone, then in `apps/mobile` run `npx expo start` (or `npm run android`) and open the project from the dev client. `npx expo prebuild --platform android --clean` regenerates the gitignored `android/` folder for inspection only.
  - **Firebase setup (done 2026-10-15)**: EAS dev keystore SHA-1/SHA-256 added to Firebase, updated `google-services.json` in place and uploaded as the `GOOGLE_SERVICES_JSON` EAS file var (development + preview), `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` set in `.env.local`. Anonymous, Google and Phone providers enabled.
- **Shared package (`packages/shared`)**: Source exported directly (`./src/index.ts`); Zod schemas for `MeResponse` and `ErrorResponse`; Haversine geo distance function (`distanceMeters`) with unit tests for Jammu coordinates and boundary cases.
- **API workspace (`apps/api`)**:
  - Cloudflare Worker running Hono with base path `/v1`.
  - D1 database backed by Drizzle ORM (`users` table) with migration generation.
  - SQLite-backed Durable Object (`QueueDO`) with meta storage and RPC `ping()` method.
  - Injectable Firebase auth verification with `jose` (RS256, issuer/audience validation, `auth_time` checks).
  - Middleware: request UUID tracking (`x-request-id`), structured JSON request logging.
  - Endpoints: `GET /v1/health` (public), `GET /v1/me` (auth, upsert user in D1), `GET /v1/dev/queue-ping/:queueId` (dev DO RPC).
  - Comprehensive integration test suite using `@cloudflare/vitest-pool-workers` against real local D1 and Durable Objects.
  - **Deployed**: `qpeer-api-dev` at `https://qpeer-api-dev.qpeer-api.workers.dev` (D1 `qpeer-dev`). D1 `qpeer-demo` created and migrated; the demo Worker is deployed in Step 5.

### Step 0 device check — 2026-10-15, Samsung Galaxy A9 (SM-A920F, Android 10)
- EAS development build (`fe8ad8c3…`) installed via adb; JS from Metro over `adb reverse tcp:8081 tcp:8081`.
- ✅ Anonymous sign-in at launch → `/v1/me` on the deployed Worker returns the D1 user (PLT-08, IDN-01).
- ✅ Mapbox renders Jammu with the marker (token from `.env.local` via Metro).
- ✅ Google sign-in links the anonymous account in place: same Firebase uid and same backend user id, provider `google.com`, `isAnonymous` false (IDN-02, IDN-04).
- ✅ Sign-out returns to a fresh anonymous user (IDN-07 core).
- ⏳ Phone sign-in with a Firebase test number: not checked yet.

### Follow-ups found in Step 0
- First launch right after install once showed "Could not sign in: No internet connection"; a restart fixed it. Add an automatic retry with backoff for the anonymous sign-in (IDN-01 robustness).
- Google link leaves `displayName` empty (Firebase doesn't copy it on link). Fill it from the Google profile after linking (IDN-06).
- `@cloudflare/vitest-pool-workers` is renamed to `@cloudflare/vitest-plugin`; migrate before the next backend task.
- Biome reports the `recommended` field in `biome.json` as deprecated; run `biome migrate`.
