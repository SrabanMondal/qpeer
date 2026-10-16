/**
 * Generates the load-test RS256 key pair (Step 3.5).
 *
 *   node scripts/loadtest/gen-key.ts [--force] [--dev-vars]
 *
 * - private JWK → secrets/loadtest-key.json (gitignored; never printed)
 * - public JWK set → secrets/loadtest-jwks.public.json (the LOADTEST_JWKS secret)
 * - --dev-vars also writes apps/api/.dev.vars.loadtest (gitignored) for
 *   `wrangler dev --env loadtest` on this machine.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  DEV_VARS_PATH,
  PRIVATE_KEY_PATH,
  PUBLIC_JWKS_PATH,
  SECRETS_DIR,
} from "./lib/paths.ts";

const { values } = parseArgs({
  options: {
    force: { type: "boolean", default: false },
    "dev-vars": { type: "boolean", default: false },
  },
});

if (existsSync(PRIVATE_KEY_PATH) && !values.force) {
  console.error(
    `Refusing to overwrite ${PRIVATE_KEY_PATH} (pass --force to rotate the key; then re-run 'wrangler secret put LOADTEST_JWKS --env loadtest').`,
  );
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const kid = `loadtest-${randomUUID().slice(0, 8)}`;
const meta = { kid, alg: "RS256", use: "sig" };
const privateJwk = { ...privateKey.export({ format: "jwk" }), ...meta };
const publicJwk = { ...publicKey.export({ format: "jwk" }), ...meta };
if ("d" in publicJwk) throw new Error("public JWK unexpectedly has 'd'");

mkdirSync(SECRETS_DIR, { recursive: true });
// No BOM, single line: `wrangler secret put` reads the file from stdin as-is.
writeFileSync(PRIVATE_KEY_PATH, JSON.stringify(privateJwk), { mode: 0o600 });
const jwks = JSON.stringify({ keys: [publicJwk] });
writeFileSync(PUBLIC_JWKS_PATH, jwks);
console.log(`kid ${kid}`);
console.log(`private key → ${PRIVATE_KEY_PATH}`);
console.log(`public JWK set → ${PUBLIC_JWKS_PATH}`);

if (values["dev-vars"]) {
  // Single quotes: dotenv keeps the JSON literally.
  writeFileSync(DEV_VARS_PATH, `LOADTEST_JWKS='${jwks}'\n`);
  console.log(`local dev vars → ${DEV_VARS_PATH}`);
}
