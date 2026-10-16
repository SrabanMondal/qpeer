import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CheckResult } from "./check.ts";
import type { RunConfig } from "./config.ts";
import type { Budget, Metrics } from "./http.ts";
import type { SimState } from "./model.ts";
import { NOTES_PATH, REPORTS_DIR } from "./paths.ts";

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  target: string;
  preset: string;
  config: {
    businesses: number;
    queuesPerBusiness: number;
    customers: number;
    durationS: number;
    budget: number;
    wsShare: number;
    mapClients: number;
    seed: number;
  };
  stoppedBy: string;
  requestsUsed: number;
  /** Requests re-sent after a failed connection (they never reached the server). */
  clientConnectRetries: number;
  /** GETs re-sent once after a broken connection. */
  clientNetworkRetries: number;
  counts: {
    tokens: number;
    joinsOk: number;
    triageOk: number;
    probes: number;
    pausedRejections: number;
    fullRejections: number;
    mapPolls: number;
    consoleResponses: number;
    joinRetriesRecovered: number;
    joinRetriesAlreadyInQueue: number;
  };
  endpoints: ReturnType<Metrics["summary"]>;
  check: CheckResult | null;
  error: string | null;
  green: boolean;
}

export function buildReport(args: {
  cfg: RunConfig;
  state: SimState;
  budget: Budget;
  metrics: Metrics;
  stoppedBy: string;
  check: CheckResult | null;
  error: string | null;
}): RunReport {
  const { cfg, state, budget, metrics, check, error } = args;
  const sum = (m: Map<string, number>) =>
    [...m.values()].reduce((a, b) => a + b, 0);
  const green =
    error === null &&
    check !== null &&
    check.invariants.every((i) => i.ok !== false);
  return {
    runId: state.runId,
    startedAt: new Date(state.startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    target: cfg.baseUrl.origin,
    preset: cfg.preset,
    config: {
      businesses: cfg.businesses,
      queuesPerBusiness: cfg.queuesPerBusiness,
      customers: cfg.customers,
      durationS: Math.round(cfg.durationMs / 1000),
      budget: cfg.budget,
      wsShare: cfg.wsShare,
      mapClients: cfg.mapClients,
      seed: cfg.seed,
    },
    stoppedBy: args.stoppedBy,
    requestsUsed: budget.used,
    clientConnectRetries: metrics.connectRetries,
    clientNetworkRetries: metrics.networkRetries,
    counts: {
      tokens: state.tokens.size,
      joinsOk: sum(state.joinsOk),
      triageOk: sum(state.triageOk),
      probes: state.probes.length,
      pausedRejections: state.pausedRejections,
      fullRejections: state.fullRejections,
      mapPolls: state.mapPolls,
      consoleResponses: state.consoleSnapshots.length,
      joinRetriesRecovered: state.joinRetries.recovered,
      joinRetriesAlreadyInQueue: state.joinRetries.viaAlreadyInQueue,
    },
    endpoints: metrics.summary(),
    check,
    error,
    green,
  };
}

function markdown(r: RunReport): string {
  const lines: string[] = [];
  lines.push(`# Load test ${r.runId} — ${r.green ? "GREEN" : "RED"}`);
  lines.push("");
  lines.push(
    `- Target: ${r.target} · preset \`${r.preset}\` · seed ${r.config.seed}`,
  );
  lines.push(`- ${r.startedAt} → ${r.finishedAt}`);
  lines.push(
    `- ${r.config.businesses} businesses × ${r.config.queuesPerBusiness} queues, ${r.config.customers} customers, ${r.config.durationS} s load, ${r.config.mapClients} map clients, WS share ${r.config.wsShare}`,
  );
  lines.push(
    `- Requests used: ${r.requestsUsed} / ${r.config.budget} (load phase stopped by: ${r.stoppedBy}); client connect retries ${r.clientConnectRetries} (never reached the server), GET retries after a broken connection ${r.clientNetworkRetries}`,
  );
  lines.push(
    `- Tokens ${r.counts.tokens} (joins ${r.counts.joinsOk}, triage ${r.counts.triageOk}), probes ${r.counts.probes}, paused rejections ${r.counts.pausedRejections}, full ${r.counts.fullRejections}, map polls ${r.counts.mapPolls}, console responses ${r.counts.consoleResponses}; lost join answers recovered by a retry ${r.counts.joinRetriesRecovered} (${r.counts.joinRetriesAlreadyInQueue} via already_in_queue)`,
  );
  if (r.error) lines.push(`- **Run error:** ${r.error}`);
  lines.push("");
  if (r.check) {
    lines.push("## Invariants");
    lines.push("");
    lines.push("| | Invariant | Detail |");
    lines.push("|---|---|---|");
    for (const i of r.check.invariants) {
      const mark = i.ok === null ? "skip" : i.ok ? "ok" : "**FAIL**";
      lines.push(`| ${mark} | ${i.name} | ${i.detail} |`);
    }
    const failing = r.check.invariants.filter((i) => i.ok === false);
    if (failing.length > 0) {
      lines.push("");
      lines.push("### Failures (first 25 each)");
      for (const i of failing) {
        lines.push("");
        lines.push(`**${i.name}**`);
        for (const f of i.failures) lines.push(`- ${f}`);
      }
    }
    lines.push("");
    lines.push("## Final token states");
    lines.push("");
    for (const [k, n] of Object.entries(r.check.tokenStates)) {
      lines.push(`- ${k}: ${n}`);
    }
    const a = r.check.analyticsTotals;
    lines.push("");
    lines.push(
      `Analytics totals: joins ${a.joins}, leaves ${a.leaves}, served ${a.served}, no-shows ${a.noShows}, cancels ${a.cancels}. Pushes recorded: ${r.check.pushesRecorded}.`,
    );
    const w = r.check.ws;
    lines.push("");
    lines.push(
      `WebSockets: ${w.sockets} clients, ${w.opened} opens, ${w.tokenMessages} token messages (${w.messages} total, ${w.pongs} pongs), ${w.reconnects} reconnects, ${w.errors} errors.`,
    );
  }
  lines.push("");
  lines.push("## Latency per endpoint (ms)");
  lines.push("");
  lines.push("| Endpoint | n | p50 | p95 | p99 | max | statuses |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const e of r.endpoints) {
    const st = Object.entries(e.statuses)
      .map(([s, n]) => `${s}×${n}`)
      .join(" ");
    lines.push(
      `| ${e.endpoint} | ${e.count} | ${e.p50} | ${e.p95} | ${e.p99} | ${e.max} | ${st} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Writes `reports/<timestamp>.md|.json` (local runs under `reports/local/`, gitignored). */
export function writeReport(r: RunReport, local: boolean): string {
  const dir = local ? path.join(REPORTS_DIR, "local") : REPORTS_DIR;
  mkdirSync(dir, { recursive: true });
  const stamp = r.startedAt.replace(/[:.]/g, "-");
  const base = path.join(dir, `${stamp}-${r.preset}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(`${base}.md`, markdown(r));
  return `${base}.md`;
}

/** One line under the NOTES.md loadtest results heading. */
export function appendNotes(r: RunReport, reportPath: string): void {
  const failing =
    r.check?.invariants.filter((i) => i.ok === false).map((i) => i.name) ?? [];
  const join = r.endpoints.find((e) => e.endpoint === "POST /queues/:id/join");
  const next = r.endpoints.find((e) => e.endpoint === "POST /queues/:id/next");
  const rel = path
    .relative(path.dirname(NOTES_PATH), reportPath)
    .replaceAll("\\", "/");
  const line = `- ${r.startedAt.slice(0, 16)}Z \`${r.preset}\` ${r.config.customers} customers / ${r.config.durationS} s: **${r.green ? "green" : "RED"}**, ${r.requestsUsed} requests, join p95 ${join?.p95 ?? "-"} ms, next p95 ${next?.p95 ?? "-"} ms${failing.length ? `; failing: ${failing.join("; ")}` : ""}${r.error ? `; error: ${r.error}` : ""} — [report](${rel})\n`;
  appendFileSync(NOTES_PATH, line);
}
