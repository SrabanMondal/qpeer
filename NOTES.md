# QPeer Build Progress Notes

## Step 0: Foundations — Repo Tooling, Shared Package, and API Skeleton with Firebase Auth
- **Repo tooling**: Biome 2.x configured at repo root with recommended lint rules and 2-space formatting; `.gitattributes` for LF line endings; `tsconfig.base.json` with strict mode; `AGENTS.md` and `CLAUDE.md` documenting monorepo conventions.
- **Mobile workspace (`apps/mobile`)**: Expo SDK 57 template configured with `typecheck` script passing cleanly.
- **Shared package (`packages/shared`)**: Source exported directly (`./src/index.ts`); Zod schemas for `MeResponse` and `ErrorResponse`; Haversine geo distance function (`distanceMeters`) with unit tests for Jammu coordinates and boundary cases.
- **API workspace (`apps/api`)**:
  - Cloudflare Worker running Hono with base path `/v1`.
  - D1 database backed by Drizzle ORM (`users` table) with migration generation.
  - SQLite-backed Durable Object (`QueueDO`) with meta storage and RPC `ping()` method.
  - Injectable Firebase auth verification with `jose` (RS256, issuer/audience validation, `auth_time` checks).
  - Middleware: request UUID tracking (`x-request-id`), structured JSON request logging.
  - Endpoints: `GET /v1/health` (public), `GET /v1/me` (auth, upsert user in D1), `GET /v1/dev/queue-ping/:queueId` (dev DO RPC).
  - Comprehensive integration test suite using `@cloudflare/vitest-pool-workers` against real local D1 and Durable Objects.
