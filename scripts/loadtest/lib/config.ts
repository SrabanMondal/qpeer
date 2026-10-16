import { parseArgs } from "node:util";

/** The only remote target the simulator and reset will ever talk to. */
export const LOADTEST_URL = "https://qpeer-api-loadtest.qpeer-api.workers.dev";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Refuses anything but the loadtest Worker. `allowLocal` additionally accepts
 * `http://127.0.0.1:<port>` / `http://localhost:<port>` (`wrangler dev --env loadtest`).
 * The server's `/v1/health` must also report `env: "loadtest"` (checked by the caller).
 */
export function assertLoadtestUrl(raw: string, allowLocal: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a URL: ${raw}`);
  }
  const clean = url.pathname === "/" && !url.search && !url.hash;
  if (clean && url.origin === LOADTEST_URL) return url;
  if (
    clean &&
    allowLocal &&
    url.protocol === "http:" &&
    LOCAL_HOSTS.has(url.hostname)
  ) {
    return url;
  }
  throw new Error(
    `Refusing base URL ${raw}: only ${LOADTEST_URL}${allowLocal ? " or a local wrangler dev URL" : " (pass --local for wrangler dev)"} is allowed.`,
  );
}

export interface RunConfig {
  baseUrl: URL;
  local: boolean;
  preset: string;
  businesses: number;
  queuesPerBusiness: number;
  customers: number;
  durationMs: number;
  budget: number;
  /** Share of customers holding a WebSocket. */
  wsShare: number;
  /** Share of customers signed in with phone (not anonymous). */
  registeredShare: number;
  /** Share of customers registering a (fake) push device. */
  deviceShare: number;
  /** Share of customers sent as rejection probes (too far / mocked / no fix). */
  probeShare: number;
  /** Share of customers that leave while waiting. */
  leaveShare: number;
  mapClients: number;
  seed: number;
  reset: boolean;
  notes: boolean;
  tailLog: string | null;
  /** Quiet time after the load phase (snapshot throttle + far fan-out are 30 s). */
  settleMs: number;
}

const PRESETS: Record<
  string,
  Pick<
    RunConfig,
    "businesses" | "queuesPerBusiness" | "customers" | "durationMs"
  >
> = {
  smoke: {
    businesses: 2,
    queuesPerBusiness: 1,
    customers: 10,
    durationMs: 30_000,
  },
  baseline: {
    businesses: 5,
    queuesPerBusiness: 2,
    customers: 50,
    durationMs: 120_000,
  },
  full: {
    businesses: 5,
    queuesPerBusiness: 2,
    customers: 300,
    durationMs: 300_000,
  },
};

/** Max queues per run: the reset/stats helpers touch ≤ 40 DOs per request. */
export const MAX_QUEUES = 30;

export const USAGE = `Usage: node scripts/loadtest/run.ts [options]
  --preset smoke|baseline|full   defaults (baseline: 50 customers, 2 min; full: 300, 5 min)
  --base-url <url>               default ${LOADTEST_URL}
  --local                        allow http://127.0.0.1:<port> (wrangler dev --env loadtest)
  --businesses <n>               default 5
  --queues-per-business <n>      default 2
  --customers <n>                default 300
  --duration <seconds>           load phase length, default 300
  --budget <n>                   hard request cap for the whole run, default 15000
  --ws-share <0..1>              default 0.4
  --map-clients <n>              default customers/60 (min 1)
  --seed <n>                     PRNG seed (default: time based)
  --no-reset                     skip the reset before the run
  --notes                        append a one-line summary to NOTES.md
  --tail-log <file>              wrangler tail output to scan for coordinates
  --settle <seconds>             quiet time before the checks, default 35`;

function num(v: string | undefined, name: string, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name}: bad number`);
  return n;
}

export function parseRunConfig(argv: string[]): RunConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      preset: { type: "string" },
      "base-url": { type: "string" },
      local: { type: "boolean", default: false },
      businesses: { type: "string" },
      "queues-per-business": { type: "string" },
      customers: { type: "string" },
      duration: { type: "string" },
      budget: { type: "string" },
      "ws-share": { type: "string" },
      "map-clients": { type: "string" },
      seed: { type: "string" },
      "no-reset": { type: "boolean", default: false },
      notes: { type: "boolean", default: false },
      "tail-log": { type: "string" },
      settle: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const presetName = values.preset ?? "full";
  const preset = PRESETS[presetName];
  if (!preset) throw new Error(`Unknown preset ${presetName}`);
  const local = values.local ?? false;
  const baseUrl = assertLoadtestUrl(values["base-url"] ?? LOADTEST_URL, local);
  const customers = Math.floor(
    num(values.customers, "customers", preset.customers),
  );
  const cfg: RunConfig = {
    baseUrl,
    local,
    preset: presetName,
    businesses: Math.max(
      1,
      Math.floor(num(values.businesses, "businesses", preset.businesses)),
    ),
    queuesPerBusiness: Math.max(
      1,
      Math.floor(
        num(
          values["queues-per-business"],
          "queues-per-business",
          preset.queuesPerBusiness,
        ),
      ),
    ),
    customers,
    durationMs:
      num(values.duration, "duration", preset.durationMs / 1000) * 1000,
    budget: Math.floor(num(values.budget, "budget", 15_000)),
    wsShare: Math.min(1, num(values["ws-share"], "ws-share", 0.4)),
    registeredShare: 0.2,
    deviceShare: 0.7,
    probeShare: 0.08,
    leaveShare: 0.12,
    mapClients: Math.max(
      1,
      Math.floor(
        num(values["map-clients"], "map-clients", Math.ceil(customers / 60)),
      ),
    ),
    seed: Math.floor(num(values.seed, "seed", Date.now() % 1_000_000_007)),
    reset: !values["no-reset"],
    notes: values.notes ?? false,
    tailLog: values["tail-log"] ?? null,
    settleMs: num(values.settle, "settle", 35) * 1000,
  };
  if (cfg.businesses * cfg.queuesPerBusiness > MAX_QUEUES) {
    throw new Error(`At most ${MAX_QUEUES} queues per run`);
  }
  if (cfg.budget > 50_000) {
    throw new Error(
      "--budget above 50000 is not allowed (free plan ≈ 100k/day)",
    );
  }
  return cfg;
}

/** Small seeded PRNG (mulberry32) so a run can be repeated with --seed. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("pick from empty list");
      return item;
    },
  };
}

export type Rng = ReturnType<typeof makeRng>;
