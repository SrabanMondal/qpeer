/**
 * HTTP client with a hard request budget and per-endpoint metrics. Every
 * request (and every WebSocket upgrade) takes one unit of budget first; once
 * the cap is reached, `take()` throws and nothing more is sent.
 */

export class BudgetExceeded extends Error {
  constructor() {
    super("request budget exhausted");
  }
}

export class Budget {
  readonly cap: number;
  used = 0;
  /** Units the load phase must leave for setup checks and the invariant checker. */
  reserve = 0;
  loadStopped = false;

  constructor(cap: number) {
    this.cap = cap;
  }

  /** Throws once the cap is reached (hard stop). */
  take(phase: "load" | "check"): void {
    if (phase === "load" && this.used >= this.cap - this.reserve) {
      this.loadStopped = true;
      throw new BudgetExceeded();
    }
    if (this.used >= this.cap) throw new BudgetExceeded();
    this.used++;
  }
}

export interface EndpointStats {
  count: number;
  statuses: Record<string, number>;
  latencies: number[];
}

export class Metrics {
  readonly endpoints = new Map<string, EndpointStats>();
  /** Requests re-sent because the connection failed (never reached the server). */
  connectRetries = 0;
  /** GETs re-sent once after a broken connection (status 0, `network:*`). */
  networkRetries = 0;

  record(endpoint: string, status: number, ms: number): void {
    let s = this.endpoints.get(endpoint);
    if (!s) {
      s = { count: 0, statuses: {}, latencies: [] };
      this.endpoints.set(endpoint, s);
    }
    s.count++;
    s.statuses[String(status)] = (s.statuses[String(status)] ?? 0) + 1;
    s.latencies.push(ms);
  }

  summary() {
    const out: {
      endpoint: string;
      count: number;
      p50: number;
      p95: number;
      p99: number;
      max: number;
      statuses: Record<string, number>;
    }[] = [];
    for (const [endpoint, s] of [...this.endpoints].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const sorted = [...s.latencies].sort((a, b) => a - b);
      out.push({
        endpoint,
        count: s.count,
        p50: pct(sorted, 50),
        p95: pct(sorted, 95),
        p99: pct(sorted, 99),
        max: Math.round(sorted[sorted.length - 1] ?? 0),
        statuses: s.statuses,
      });
    }
    return out;
  }
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return Math.round(sorted[Math.max(0, i)] ?? 0);
}

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
  /** `error` code of an error body, if any. */
  code: string | null;
  ms: number;
  /**
   * Why status is 0: `timeout` (sent, no answer in TIMEOUT_MS), `connect`
   * (no connection after the retries, so never sent) or `network:<code>`
   * (connection broke; the request may or may not have reached the server).
   */
  error: string | null;
}

/** Whole-request timeout (the request may have reached the server). */
const TIMEOUT_MS = 20_000;
/**
 * Connection failures mean the request was never sent (Node's fetch gives up
 * connecting after 10 s: `UND_ERR_CONNECT_TIMEOUT`), so any method is safe to
 * retry. Step 3.5 F2: all ~10 s "timeouts" were these, on the client's side.
 */
const CONNECT_RETRIES = 2;
const CONNECT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/** Classifies a fetch failure (undici puts the socket error in `cause`). */
export function fetchErrorKind(e: unknown): string {
  if (e instanceof Error && e.name === "TimeoutError") return "timeout";
  if (e instanceof SyntaxError) return "bad_json";
  const cause = e instanceof Error ? (e.cause as { code?: unknown }) : null;
  const code = typeof cause?.code === "string" ? cause.code : null;
  if (code && CONNECT_CODES.has(code)) return "connect";
  return `network:${code ?? (e instanceof Error ? e.name : "unknown")}`;
}

export class Api {
  readonly base: URL;
  readonly budget: Budget;
  readonly metrics: Metrics;
  phase: "load" | "check" = "load";

  constructor(base: URL, budget: Budget, metrics: Metrics) {
    this.base = base;
    this.budget = budget;
    this.metrics = metrics;
  }

  /**
   * `endpoint` is the route template used for metrics ("POST /queues/:id/join").
   * Never put coordinates in `path` (they go in the body).
   */
  async req<T = unknown>(
    method: string,
    path: string,
    endpoint: string,
    token: string | null,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const start = performance.now();
    let status = 0;
    let parsed: unknown = null;
    let error: string | null = null;
    for (let attempt = 0; ; attempt++) {
      this.budget.take(this.phase);
      status = 0;
      error = null;
      try {
        const res = await fetch(new URL(path, this.base), {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        status = res.status;
        const text = await res.text();
        parsed = text ? JSON.parse(text) : null;
      } catch (e) {
        error = fetchErrorKind(e);
        if (status !== 0) {
          // Headers arrived but the body didn't (timeout or reset while
          // reading) or wasn't JSON. Report it as no answer: a 200 with a
          // null body crashed the staff loop (Step 3.5 F4).
          error = `bad_body:${status}:${error}`;
          status = 0;
          parsed = null;
        }
      }
      if (status !== 0 || attempt >= CONNECT_RETRIES) break;
      if (error === "connect") {
        this.metrics.connectRetries++;
        continue;
      }
      // A GET is idempotent: after a broken connection (e.g. ECONNRESET on a
      // reused keep-alive socket) re-send it once, as the app's next poll
      // would (G2). Timeouts are not retried: they mean the server was slow.
      if (method === "GET" && error?.startsWith("network:") && attempt === 0) {
        this.metrics.networkRetries++;
        continue;
      }
      break;
    }
    const ms = performance.now() - start;
    this.metrics.record(`${method} ${endpoint}`, status, ms);
    const code =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : null;
    return { status, body: parsed as T, code, ms, error };
  }

  wsUrl(path: string): string {
    const u = new URL(path, this.base);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  }
}
