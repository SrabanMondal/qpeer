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
- ✅ Phone sign-in with a Firebase test number works (checked by the user, no rebuild needed). Wrong-code and resend paths not checked yet.

## Step 1 backend — business module (2026-10-15, branch `feat/step1-backend`)
- **Layout** now follows architecture doc §3: `src/env.ts`, `middleware/{request-context,auth,guards}.ts`, `lib/{errors,validate,time,ids,geo}.ts`, `db/{schema,client}.ts`, `modules/{identity,business,dev}/`. `src/auth.ts` moved into `middleware/auth.ts` (`makeFirebaseVerifier` still exported). `queue-do.ts` untouched (Step 2).
- **Errors**: `AppError(status, code, message?, details?)` + `onError`; body `{ error, message?, requestId, details? }`; unknown routes → 404 `not_found`; validation → 400 `invalid_input` with `details: [{ path, message }]`.
- **Guards**: `requireRegistered()` (403 `registration_required`), `requireBusinessRole(role, "business" | "queue")` → 404 when the business/queue is missing **or** the caller isn't a member, 403 `forbidden` for staff on owner routes.
- **Endpoints**: `PATCH /v1/me`, `POST /v1/businesses`, `GET /v1/me/businesses`, `GET/PATCH /v1/businesses/:id`, `POST /v1/businesses/:id/{deactivate,activate,queues}`, `GET/PATCH /v1/queues/:id`, `POST /v1/queues/:id/archive`.
- **Data**: migration `0001_step1_business.sql` adds `businesses`, `business_members`, `queues`, `users.free_lane_blocked_until`, and converts `users` timestamps seconds → ms (hand-added `UPDATE … * 1000` guarded by `< 1e11`). All timestamps are `integer(mode: "timestamp_ms")`.
- **Shared**: `BusinessCategory`, `LatLng` (now a zod schema; the type is unchanged), `HoursRange`/`WeeklyHours`/`defaultWeeklyHours()`, `QueueSettings` (+ `QueueSettingsPatch`, defaults per §8), request bodies, `BusinessView`, `QueueView`, `MyBusinessesResponse`, `QueueInfoResponse`, `ErrorCode`, `ValidationIssue`; `ErrorResponse.error` is now the `ErrorCode` enum.
- **Decisions**:
  - The token `name` claim only fills `display_name` while it is empty, so a name set with `PATCH /me` survives later sign-ins (previously every request overwrote it).
  - Request bodies are `.strict()` (unknown keys → 400). Update bodies need at least one field. `phone: null` clears the phone. The pin can be moved but not removed.
  - Owner routes also run `requireRegistered()` first (defence in depth).
  - Queue limit (10 active) is enforced in one `INSERT … SELECT … WHERE count < 10` so parallel creates can't exceed it.
  - `settings_version` only increments when the merged settings actually differ; queue updates are guarded on the version read (409 `conflict` on a concurrent change).
  - Archived queues: can't be edited (409 `invalid_state`), archive is idempotent, no unarchive yet. Members see archived queues; public views don't.
  - Deactivate/activate are idempotent; `updated_at` only moves on a real status change.
  - `GET /v1/queues/:id` returns `{ queue, business, myRole }`; 404 for non-members unless the queue is active and the business is listed.
  - Lists are ordered oldest first and not paginated yet (a user has few businesses; max 10 active queues each).
- **Deferred**: deactivation closing open queues, pushing new settings to QueueDO, `countActiveTokens` (returns 0, `// Step 2: ask QueueDO`), staff invites (BIZ-17), pagination of `/me/businesses`, `requireDevEnv` beyond "not demo".

## Step 1 mobile — app structure, design basics, profile, business screens (2026-10-15, branch `feat/step1-mobile`)
- **Backend addition**: `users.preferred_mode` (`customer` | `business`, nullable; migration `0002_step1_preferred_mode.sql`). `PATCH /v1/me` takes `displayName` and/or `preferredMode` (at least one); anonymous users get 403 `registration_required` for `business`. `MeResponse.user.preferredMode`. Shared: `AppMode`, `DisplayName`. Tests in `test/business.test.ts` ("IDN-08 …").
- **Design**: follows `docs/QPeer_v1_UI_Design_Guide.md`. Tokens (colours light/dark, type scale, radii, spacing) live only in `src/constants/theme.ts`; `ThemedText` takes `type` = display/title/heading/body/label/small and `themeColor` = a token. Icons are Material Symbols through `expo-symbols` (on Android it draws with a bundled font via expo-font, so no native rebuild).
- **Navigation** (`src/app`): root native Stack = `(tabs)` + pushed detail screens. `(tabs)/_layout.tsx` uses JS bottom tabs (`expo-router/js-tabs`). Customer: Home (placeholder "Live queue map arrives in Step 3"), Queue (placeholder, Step 2), Profile. Business: Queue (console placeholder, Step 2), Business, Insights (placeholder, Step 5), Profile. The other mode's tabs are hidden with `href: null`; Home/Business/Insights redirect if opened in the wrong mode. Pushed: `sign-in` (`?mode=business` switches after sign-in), `map-check`, `business/new`, `business/[id]` (+ `/edit`, `/location`, `/hours`, `/new-queue`), `queue/[id]` (+ `/qr`).
- **Mode (IDN-08)**: `src/lib/mode.ts`. Mode = `preferredMode` from `/v1/me` (business only when registered), so it is restored on launch. Switch: Profile (ModeSwitch card) and the toggle on the Business tab's dark header (`components/header-mode-switch.tsx`). Anonymous → Business opens sign-in first.
- **UI kit** (`src/components/ui/`): Screen, Button (primary/brand/secondary/outline/danger-soft, icon, loading), TextField, Card, ListItem, InfoRow, SectionHeader, StatusBanner, Badge, ModeSwitch, ChoiceChips, HeaderButton, Icon, LoadingState/EmptyState/ErrorState (message + code + request ID + Retry), ConfirmDialog (`ConfirmDialog.show()` wraps `Alert.alert`), ConnectionBanner. Not built yet (Step 2/3): StatRow, NumberBadge, MapPill, BottomSheetCard.
- **API layer** (`src/lib/api/`): `client.ts` (`apiFetch`, `ApiError` with `issues` for `invalid_input`), `me.ts`, `businesses.ts`, `queues.ts`, `keys.ts` (query keys scoped by uid). Mutations write the returned view into the cache and invalidate lists. 4xx answers are not retried. Error texts per `ErrorCode` in `src/lib/error-messages.ts`.
- **Auth**: anonymous sign-in retries with backoff 1/2/4/8 s then every 15 s, showing a non-blocking "Connecting…" banner with Retry (IDN-01). After Google sign-in/link, an empty Firebase `displayName` is filled from the Google profile and the ID token is force-refreshed, so the backend fills `display_name` (IDN-06).
- **Business screens**: list with status badges, create/edit with shared zod validation, business screen with StatusBanner (Listed / Not listed: add a pin / add a queue / Inactive), fixed-centre pin picker (existing pin → phone location → Jammu; "Use my location"), hours editor (Closed switch, up to 3 ranges, HH:MM field with ±30 min steppers, 12-hour preview, "Closed today"), queue screen (rename, settings in Joining/Fees/Timing/Counters with ₹ ↔ paise, archive with confirm), full-screen QR with Share link (RN `Share`).
- **Decisions**: settings form shows join radius, max size, walk-in share, both fees, grace, cancel window, service time, counters; the other settings (priority ratio, business share, triage cap, paid cap) keep their values and are not shown yet. Times are stored 24 h, shown 12 h. Unsaved edits are not guarded on back.
- **TODO(native)**: share/save the QR **as an image** (needs react-native-view-shot + expo-sharing / expo-media-library and a rebuild).
- **Typed routes**: `.expo/types/router.d.ts` is generated (gitignored); `npx expo start` regenerates it after route changes.

### Follow-ups found in Step 0
- First launch right after install once showed "Could not sign in: No internet connection"; a restart fixed it. Add an automatic retry with backoff for the anonymous sign-in (IDN-01 robustness).
- Google link leaves `displayName` empty (Firebase doesn't copy it on link). Fill it from the Google profile after linking (IDN-06).
- `@cloudflare/vitest-pool-workers` is renamed to `@cloudflare/vitest-plugin`; migrate before the next backend task.
- Biome reports the `recommended` field in `biome.json` as deprecated; run `biome migrate`.

### Step 1 device check — 2026-10-15, Samsung Galaxy A9 (Android 10), dev build + Metro
Signed in with a Firebase test phone number.
- ✅ Icons (Material Symbols via expo-symbols) render on Android; tabs, dark theme and cards match the design guide.
- ✅ App recovers by itself when the network returns.
- ✅ Profile: edit display name saved (IDN-06). Mode switch → Business tabs; mode survives kill + relaunch (IDN-08).
- ✅ Create business: empty submit shows field errors; valid submit opens the business screen with "Not listed yet: add a pin / add a queue".
- ✅ Set pin: fixed centre pin, coordinates follow the map, save works, banner updates (BIZ-03). Without device location it falls back to Jammu with a clear message.
- ✅ Hours editor: add range, overlap → blocked with "Ranges must not overlap" marked in red; Sunday shows Closed (BIZ-06). A valid save was not checked.
- ✅ Create queue "OPD" with default settings; QR screen + Share link (share sheet opened, nothing sent); business becomes "Listed on the map" (BIZ-07, BIZ-10, BIZ-14 partial).
- ✅ Deactivate (with confirm) → Inactive; Activate → Listed again (BIZ-08 core, NFR-13).
- Not checked on device: edit profile fields, move pin later, settings validation (radius 20), rename/archive queue, sign out, light theme.

### Bugs and polish from the Step 1 device check
- **B1 (bug):** offline launch with a signed-in user hangs on "Starting…" (waits for `/v1/me`) and retries the ID token about twice a second without backoff. Expected: open with the last known mode + an offline/"Connecting…" banner, back off retries.
- **B2:** keyboard covers the Save button on the profile name editor (needs keyboard-aware scrolling on forms).
- **B3:** Business header is cramped: the "Business" toggle label runs into the "My businesses" title.
- **B4:** field errors stay visible after the value becomes valid; they should clear as the user types.
- **B5 (note):** the phone's device location was off; the walk-in GPS check (Step 2) needs a clear "turn on location" path.
- **B6 (UX):** hours editor is long (7 large cards); add "Copy to weekdays"/"Copy to all" later.
- **B7:** on an invalid hours save, the dialog doesn't scroll to the first invalid day.
- **B8:** leaving a form with unsaved edits discards them silently; ask "Discard changes?".
