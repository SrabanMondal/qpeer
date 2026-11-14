/**
 * Step 5 demo reset (DEM-05, DEM-06).
 *
 *   node scripts/demo/reset.ts --env demo [--wipe-all] [--no-seed] [--weeks 6] [--owner-phone +91…]
 *   node scripts/demo/reset.ts --env dev            (demo rows only)
 *
 * Closes the demo queues, waits for their outboxes, deletes the demo rows
 * (seeded businesses and everything under them, simulated `demo:` users),
 * then seeds again unless --no-seed. `--wipe-all` (demo only) also empties
 * every business, ticket and payment table on the demo environment; user
 * accounts stay, so phones stay signed in. Never touches real data on dev.
 */
import { parseArgs } from "node:util";
import { loadSigner } from "./lib/jwt.ts";
import { resetAll, seedAll } from "./lib/seed.ts";
import { assertTarget, log, makeApi, resolveTarget } from "./lib/target.ts";

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    local: { type: "boolean", default: false },
    "base-url": { type: "string" },
    "wipe-all": { type: "boolean", default: false },
    "no-seed": { type: "boolean", default: false },
    weeks: { type: "string", default: "6" },
    seed: { type: "string", default: "qpeer-demo" },
    "owner-phone": { type: "string", multiple: true, default: [] },
    budget: { type: "string", default: "300" },
    key: { type: "string" },
  },
});

async function main() {
  const target = resolveTarget({
    env: values.env,
    local: values.local,
    baseUrl: values["base-url"],
  });
  if (values["wipe-all"] && target.env === "dev") {
    throw new Error("--wipe-all only runs against --env demo (or --local).");
  }
  const weeks = Number(values.weeks);
  if (!Number.isInteger(weeks) || weeks < 4 || weeks > 8) {
    throw new Error("--weeks must be 4 to 8");
  }
  const api = makeApi(target, Number(values.budget));
  const signer = loadSigner(values.key);
  const env = await assertTarget(api, target);
  log(
    `reset → ${target.baseUrl.origin} (env ${env})${values["wipe-all"] ? ", wipe all" : ", demo rows only"}`,
  );
  await resetAll(api, signer, values["wipe-all"]);
  if (!values["no-seed"]) {
    await seedAll(api, signer, {
      weeks,
      seed: values.seed,
      ownerPhones: values["owner-phone"],
      noHistory: false,
    });
  }
  log(`done: ${api.budget.used} requests`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
