/**
 * Generates the Ed25519 key that signs offline tickets (C3).
 *
 *   node scripts/ticket-keys/gen-key.ts [--force] [--app]
 *
 * - private JWK (with kid) → secrets/ticket-signing-key.json (gitignored;
 *   never printed). This file is the `TICKET_SIGNING_KEY` Worker secret:
 *   `npx wrangler secret put TICKET_SIGNING_KEY --env dev < ../../secrets/ticket-signing-key.json`
 *   from apps/api (Git Bash), once per environment.
 * - public JWK set → secrets/ticket-public-keys.json.
 * - --app also writes the public JWK set to
 *   apps/mobile/src/constants/ticket-public-keys.json, the copy bundled in
 *   the app as a fallback for offline verification (public data: commit it).
 *
 * Rotation: run with --force, keep the old public key in the Worker var
 * `TICKET_PUBLIC_KEYS` (JSON JWK set) and in the app's bundled set until
 * every old ticket has expired (7 days at most).
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SECRETS_DIR = path.join(REPO_ROOT, "secrets");
const PRIVATE_KEY_PATH = path.join(SECRETS_DIR, "ticket-signing-key.json");
const PUBLIC_KEYS_PATH = path.join(SECRETS_DIR, "ticket-public-keys.json");
const APP_KEYS_PATH = path.join(
  REPO_ROOT,
  "apps",
  "mobile",
  "src",
  "constants",
  "ticket-public-keys.json",
);

const { values } = parseArgs({
  options: {
    force: { type: "boolean", default: false },
    app: { type: "boolean", default: false },
  },
});

if (existsSync(PRIVATE_KEY_PATH) && !values.force) {
  console.error(
    `Refusing to overwrite ${PRIVATE_KEY_PATH} (pass --force to rotate; see the comment at the top of this script).`,
  );
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const kid = `ticket-${randomUUID().slice(0, 8)}`;
const meta = { kid, alg: "EdDSA", use: "sig" };
const privateJwk = { ...privateKey.export({ format: "jwk" }), ...meta };
const publicJwk = { ...publicKey.export({ format: "jwk" }), ...meta };
if ("d" in publicJwk) throw new Error("public JWK unexpectedly has 'd'");
if (privateJwk.crv !== "Ed25519") throw new Error("not an Ed25519 key");

mkdirSync(SECRETS_DIR, { recursive: true });
// No BOM, single line: `wrangler secret put` reads the file from stdin as-is.
writeFileSync(PRIVATE_KEY_PATH, JSON.stringify(privateJwk), { mode: 0o600 });
writeFileSync(PUBLIC_KEYS_PATH, JSON.stringify({ keys: [publicJwk] }));
console.log(`kid ${kid}`);
console.log(`private key → ${PRIVATE_KEY_PATH}`);
console.log(`public JWK set → ${PUBLIC_KEYS_PATH}`);

if (values.app) {
  // Keep keys already bundled (rotation): the new one goes first.
  let old: { kid?: string }[] = [];
  if (existsSync(APP_KEYS_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(APP_KEYS_PATH, "utf8")) as {
        keys?: { kid?: string }[];
      };
      old = parsed.keys ?? [];
    } catch {
      old = [];
    }
  }
  const keys = [publicJwk, ...old.filter((k) => k.kid !== kid)];
  writeFileSync(APP_KEYS_PATH, `${JSON.stringify({ keys }, null, 2)}\n`);
  console.log(`app's bundled public keys → ${APP_KEYS_PATH}`);
}
