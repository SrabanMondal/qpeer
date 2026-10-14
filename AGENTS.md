# QPeer Agent Conventions

## Repository Layout
- `apps/mobile`: Expo (React Native) Android application. See `apps/mobile/AGENTS.md` for Expo-specific rules.
- `apps/api`: Cloudflare Workers backend (Hono, D1 via Drizzle ORM, SQLite-backed Durable Objects).
- `packages/shared`: Shared TypeScript package providing Zod validation schemas, inferred types, math, and geo utilities.
- `docs/`: System documentation. Read `docs/QPeer_v1_High_Level_Design.md` before making architectural changes.
- `scripts/`: Dev scripts (e.g. data seeding and live simulation).

## Essential Commands
- `npm run check`: Run root validation check (`typecheck` + `lint` via Biome + `test` across workspaces). Must pass with zero errors.
- `npm run typecheck --workspace=<workspace>`: Run workspace-specific typecheck (`apps/mobile`, `apps/api`, `packages/shared`).
- `npm run test --workspace=<workspace>`: Run workspace-specific unit / integration tests.
- `npx wrangler dev`: Run API development server locally inside `apps/api`.
- `npx biome check --write .`: Format and check linting across codebase.

## Engineering Rules
1. **TypeScript Strict**: `strict: true` is enforced across all packages. Do not use `any` unless strictly necessary for third-party interop.
2. **Single Source of Truth**: All request and response shapes, validation rules, and shared business schemas live in `packages/shared` using Zod schemas.
3. **No Network Installs**: All dependencies are pre-installed. Never run `npm install` or `npx <new-package>`. If a dependency is missing, report it as a blocker.
4. **Backend Testing**: All backend logic, migrations, authorization, and endpoint behaviors must be covered by integration tests using `@cloudflare/vitest-pool-workers`.
5. **Mobile Rules**: Follow Expo SDK 57 conventions in `apps/mobile/AGENTS.md`. Never edit generated native folders directly.
