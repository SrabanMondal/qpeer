import path from "node:path";

/** Repo root (this file is scripts/loadtest/lib/paths.ts). */
export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
export const SECRETS_DIR = path.join(REPO_ROOT, "secrets");
/** Private RS256 JWK (gitignored `secrets/`). Never printed. */
export const PRIVATE_KEY_PATH = path.join(SECRETS_DIR, "loadtest-key.json");
/** Public JWK set: the value of the `LOADTEST_JWKS` secret. */
export const PUBLIC_JWKS_PATH = path.join(
  SECRETS_DIR,
  "loadtest-jwks.public.json",
);
/** Local `wrangler dev --env loadtest` secrets (gitignored `.dev.vars.*`). */
export const DEV_VARS_PATH = path.join(
  REPO_ROOT,
  "apps",
  "api",
  ".dev.vars.loadtest",
);
export const REPORTS_DIR = path.join(
  REPO_ROOT,
  "scripts",
  "loadtest",
  "reports",
);
export const NOTES_PATH = path.join(REPO_ROOT, "NOTES.md");
