/**
 * Step 3.5 load & correctness test against the `loadtest` Worker only.
 *
 *   node scripts/loadtest/run.ts --preset baseline|full [--notes] [--tail-log file]
 *   node scripts/loadtest/run.ts --preset smoke --local --base-url http://127.0.0.1:8787
 *
 * Phases: health check (env must be "loadtest") → reset → setup → load
 * (customers, staff, map pollers; hard stop at the request budget) → settle →
 * invariant checks → close queues → more checks → report.
 */
import { type CheckResult, checkPhase } from "./lib/check.ts";
import { makeRng, parseRunConfig } from "./lib/config.ts";
import { Api, Budget, Metrics } from "./lib/http.ts";
import { loadSigner } from "./lib/jwt.ts";
import { newState } from "./lib/model.ts";
import { appendNotes, buildReport, writeReport } from "./lib/report.ts";
import { assertLoadtestServer, resetServer } from "./lib/reset.ts";
import { loadPhase, setup } from "./lib/sim.ts";

const log = (m: string) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function main() {
  const cfg = parseRunConfig(process.argv.slice(2));
  const signer = loadSigner();
  const budget = new Budget(cfg.budget);
  const queues = cfg.businesses * cfg.queuesPerBusiness;
  // Left for the checker: stats polls, 2 audits + close per queue, samples, map.
  budget.reserve = 80 + queues * 10;
  const metrics = new Metrics();
  const api = new Api(cfg.baseUrl, budget, metrics);
  const rng = makeRng(cfg.seed);
  const runId = `${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "")}${rng.int(10, 99)}`;
  const state = newState(runId);

  log(
    `run ${runId}: ${cfg.baseUrl.origin}, preset ${cfg.preset}, ${cfg.customers} customers, ${cfg.durationMs / 1000} s, budget ${cfg.budget}, seed ${cfg.seed}`,
  );
  api.phase = "check"; // setup counts against the whole budget, not the load share
  await assertLoadtestServer(api);
  if (cfg.reset) await resetServer(api, signer, log);

  let stoppedBy = "not started";
  let check: CheckResult | null = null;
  let error: string | null = null;
  try {
    await setup({ cfg, api, signer, rng, state, log });
    api.phase = "load";
    log("load phase started");
    ({ stoppedBy } = await loadPhase({ cfg, api, signer, rng, state, log }));
    log(
      `load phase done (${stoppedBy}): ${state.tokens.size} tokens, ${budget.used} requests`,
    );
    check = await checkPhase({ cfg, api, signer, state, log });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    log(`run failed: ${error}`);
  } finally {
    for (const t of state.tokens.values()) t.live?.close();
  }

  const report = buildReport({
    cfg,
    state,
    budget,
    metrics,
    stoppedBy,
    check,
    error,
  });
  const file = writeReport(report, cfg.local);
  if (cfg.notes) appendNotes(report, file);
  for (const i of check?.invariants ?? []) {
    log(`${i.ok === null ? "skip" : i.ok ? " ok " : "FAIL"}  ${i.name}`);
  }
  log(
    `${report.green ? "GREEN" : "RED"} · ${budget.used}/${cfg.budget} requests · report ${file}`,
  );
  process.exitCode = report.green ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
});
