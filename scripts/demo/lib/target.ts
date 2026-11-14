import path from "node:path";
import { Api, Budget, Metrics } from "../../loadtest/lib/http.ts";

/**
 * DEM-06: the demo tools talk only to the `dev` or `demo` Worker (or to a
 * local `wrangler dev` with --local). The base URL comes from a fixed list,
 * never from free text, and `/v1/health` must report the same environment
 * before anything is written. Every request takes one unit of a hard budget.
 */

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
export const SECRETS_DIR = path.join(REPO_ROOT, "secrets");
/** Private RS256 JWK of the demo key (gitignored `secrets/`). Never printed. */
export const DEMO_PRIVATE_KEY_PATH = path.join(SECRETS_DIR, "demo-key.json");
/** Public JWK set: the value of the `DEMO_JWKS` secret. */
export const DEMO_PUBLIC_JWKS_PATH = path.join(
  SECRETS_DIR,
  "demo-jwks.public.json",
);

export const TARGETS = {
  dev: "https://qpeer-api-dev.qpeer-api.workers.dev",
  demo: "https://qpeer-api-demo.qpeer-api.workers.dev",
} as const;
export type TargetEnv = keyof typeof TARGETS;

const LOCAL_URLS = new Set(["http://127.0.0.1:8787", "http://localhost:8787"]);

export interface Target {
  env: TargetEnv | "local";
  baseUrl: URL;
}

/**
 * `--env dev|demo` picks the deployed Worker; `--local` (with an optional
 * `--base-url http://127.0.0.1:8787`) picks wrangler dev. Anything else is
 * refused before a single request.
 */
export function resolveTarget(o: {
  env?: string;
  local?: boolean;
  baseUrl?: string;
}): Target {
  if (o.local) {
    const url = (o.baseUrl ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
    if (!LOCAL_URLS.has(url)) {
      throw new Error(`--local only allows ${[...LOCAL_URLS].join(" or ")}`);
    }
    return { env: "local", baseUrl: new URL(url) };
  }
  if (o.env !== "dev" && o.env !== "demo") {
    throw new Error(
      "Choose the target with --env dev or --env demo (or --local).",
    );
  }
  if (o.baseUrl && o.baseUrl.replace(/\/+$/, "") !== TARGETS[o.env]) {
    throw new Error(
      `Refusing --base-url ${o.baseUrl}: --env ${o.env} is ${TARGETS[o.env]}.`,
    );
  }
  return { env: o.env, baseUrl: new URL(TARGETS[o.env]) };
}

/** The API client with a hard request budget (shared with the load test). */
export function makeApi(target: Target, budget: number): Api {
  const api = new Api(target.baseUrl, new Budget(budget), new Metrics());
  api.phase = "check"; // no load-phase reserve: one plain budget
  return api;
}

/**
 * `/v1/health` must say the environment we were told to use (local runs of
 * wrangler dev may be `local`, `dev` or `demo`). Anything else aborts.
 */
export async function assertTarget(api: Api, target: Target): Promise<string> {
  const r = await api.req<{ env?: string }>(
    "GET",
    "/v1/health",
    "/health",
    null,
  );
  const env = r.body?.env ?? null;
  const ok =
    r.status === 200 &&
    (target.env === "local"
      ? env === "local" || env === "dev" || env === "demo"
      : env === target.env);
  if (!ok) {
    throw new Error(
      `Refusing: ${target.baseUrl.origin}/v1/health reports env ${JSON.stringify(env)} (status ${r.status}), expected ${target.env === "local" ? "local/dev/demo" : JSON.stringify(target.env)}.`,
    );
  }
  return env as string;
}

export const log = (m: string) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Throws with the status and error code of a failed call (never the body). */
export function must<T>(
  r: { status: number; code: string | null; body: T; error: string | null },
  what: string,
  ok: number[] = [200, 201],
): T {
  if (!ok.includes(r.status)) {
    throw new Error(`${what} failed: ${r.status} ${r.code ?? r.error ?? ""}`);
  }
  return r.body;
}
