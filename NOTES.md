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
  - **Pending before Google sign-in works**: add the SHA-1 of the EAS development keystore (`eas credentials`) to the Firebase Android app, download the updated `google-services.json` (and update the `GOOGLE_SERVICES_JSON` EAS file var), and set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the Firebase "Web client" OAuth ID. Enable Anonymous, Google and Phone providers in Firebase Auth and add test phone numbers.
- **Shared package (`packages/shared`)**: Source exported directly (`./src/index.ts`); Zod schemas for `MeResponse` and `ErrorResponse`; Haversine geo distance function (`distanceMeters`) with unit tests for Jammu coordinates and boundary cases.
- **API workspace (`apps/api`)**:
  - Cloudflare Worker running Hono with base path `/v1`.
  - D1 database backed by Drizzle ORM (`users` table) with migration generation.
  - SQLite-backed Durable Object (`QueueDO`) with meta storage and RPC `ping()` method.
  - Injectable Firebase auth verification with `jose` (RS256, issuer/audience validation, `auth_time` checks).
  - Middleware: request UUID tracking (`x-request-id`), structured JSON request logging.
  - Endpoints: `GET /v1/health` (public), `GET /v1/me` (auth, upsert user in D1), `GET /v1/dev/queue-ping/:queueId` (dev DO RPC).
  - Comprehensive integration test suite using `@cloudflare/vitest-pool-workers` against real local D1 and Durable Objects.
