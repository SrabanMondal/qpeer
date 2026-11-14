/**
 * Step 5 demo seed (DEM-01…03, DEM-06).
 *
 *   node scripts/demo/seed.ts --env demo [--weeks 6] [--owner-phone +91…] [--seed qpeer-demo]
 *   node scripts/demo/seed.ts --env dev  …        (demo rows only; real data untouched)
 *   node scripts/demo/seed.ts --local             (wrangler dev on 127.0.0.1:8787)
 *
 * Writes 12 businesses across Jammu with queues, pins, hours and owners, plus
 * `--weeks` (4–8) of synthetic analytics and past payments. Idempotent; run
 * `reset.ts` first for a clean slate. `--owner-phone` (repeatable, ≤ 5) makes
 * that account an owner of every demo business: it must have signed in on
 * the same environment once.
 */
import { parseArgs } from "node:util";
import { loadSigner } from "./lib/jwt.ts";
import { seedAll } from "./lib/seed.ts";
import { assertTarget, log, makeApi, resolveTarget } from "./lib/target.ts";

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    local: { type: "boolean", default: false },
    "base-url": { type: "string" },
    weeks: { type: "string", default: "6" },
    seed: { type: "string", default: "qpeer-demo" },
    "owner-phone": { type: "string", multiple: true, default: [] },
    "no-history": { type: "boolean", default: false },
    budget: { type: "string", default: "200" },
    key: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(
    "node scripts/demo/seed.ts --env dev|demo | --local [--weeks 4-8] [--owner-phone +91…] [--seed name] [--no-history] [--budget 200]",
  );
  process.exit(0);
}

async function main() {
  const weeks = Number(values.weeks);
  if (!Number.isInteger(weeks) || weeks < 4 || weeks > 8) {
    throw new Error("--weeks must be 4 to 8");
  }
  const target = resolveTarget({
    env: values.env,
    local: values.local,
    baseUrl: values["base-url"],
  });
  const api = makeApi(target, Number(values.budget));
  const signer = loadSigner(values.key);
  const env = await assertTarget(api, target);
  log(`seed → ${target.baseUrl.origin} (env ${env}), ${weeks} weeks`);
  await seedAll(api, signer, {
    weeks,
    seed: values.seed,
    ownerPhones: values["owner-phone"],
    noHistory: values["no-history"],
  });
  log(`done: ${api.budget.used} requests`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
