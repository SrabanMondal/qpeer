/**
 * Closes every queue and wipes the loadtest D1 tables so runs are repeatable.
 * Refuses any target but the loadtest Worker (or, with --local, wrangler dev),
 * and the server must report env "loadtest".
 *
 *   node scripts/loadtest/reset.ts [--local --base-url http://127.0.0.1:8787]
 */
import { parseArgs } from "node:util";
import { assertLoadtestUrl, LOADTEST_URL } from "./lib/config.ts";
import { Api, Budget, Metrics } from "./lib/http.ts";
import { loadSigner } from "./lib/jwt.ts";
import { assertLoadtestServer, resetServer } from "./lib/reset.ts";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    local: { type: "boolean", default: false },
  },
});

async function main() {
  const base = assertLoadtestUrl(
    values["base-url"] ?? LOADTEST_URL,
    values.local ?? false,
  );
  const api = new Api(base, new Budget(100), new Metrics());
  api.phase = "check";
  await assertLoadtestServer(api);
  await resetServer(api, loadSigner(), (m) => console.log(m));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
