/**
 * Generates the demo-tools RS256 key pair (Step 5).
 *
 *   node scripts/demo/gen-key.ts [--force] [--dev-vars]
 *
 * - private JWK → secrets/demo-key.json (gitignored; never printed)
 * - public JWK set → secrets/demo-jwks.public.json (the DEMO_JWKS secret of
 *   the `demo` and `dev` Workers)
 * - --dev-vars also writes apps/api/.dev.vars.demo (gitignored) for
 *   `wrangler dev --env demo` on this machine.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  DEMO_PRIVATE_KEY_PATH,
  DEMO_PUBLIC_JWKS_PATH,
  REPO_ROOT,
  SECRETS_DIR,
} from "./lib/target.ts";

const { values } = parseArgs({
  options: {
    force: { type: "boolean", default: false },
    "dev-vars": { type: "boolean", default: false },
  },
});

if (existsSync(DEMO_PRIVATE_KEY_PATH) && !values.force) {
  console.error(
    `Refusing to overwrite ${DEMO_PRIVATE_KEY_PATH} (pass --force to rotate the key; then put DEMO_JWKS again on dev and demo).`,
  );
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const kid = `demo-${randomUUID().slice(0, 8)}`;
const meta = { kid, alg: "RS256", use: "sig" };
const privateJwk = { ...privateKey.export({ format: "jwk" }), ...meta };
const publicJwk = { ...publicKey.export({ format: "jwk" }), ...meta };
if ("d" in publicJwk) throw new Error("public JWK unexpectedly has 'd'");

mkdirSync(SECRETS_DIR, { recursive: true });
// No BOM, single line: `wrangler secret put` reads the file from stdin as-is.
writeFileSync(DEMO_PRIVATE_KEY_PATH, JSON.stringify(privateJwk), {
  mode: 0o600,
});
const jwks = JSON.stringify({ keys: [publicJwk] });
writeFileSync(DEMO_PUBLIC_JWKS_PATH, jwks);
console.log(`kid ${kid}`);
console.log(`private key → ${DEMO_PRIVATE_KEY_PATH}`);
console.log(`public JWK set → ${DEMO_PUBLIC_JWKS_PATH}`);

if (values["dev-vars"]) {
  const devVars = path.join(REPO_ROOT, "apps", "api", ".dev.vars.demo");
  // Single quotes: dotenv keeps the JSON literally.
  writeFileSync(devVars, `DEMO_JWKS='${jwks}'\n`);
  console.log(`local dev vars → ${devVars}`);
}
