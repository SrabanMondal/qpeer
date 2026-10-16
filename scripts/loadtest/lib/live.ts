import { type Api, BudgetExceeded } from "./http.ts";

/**
 * One customer's live socket (`GET /v1/queues/:id/live?tokenId=…`), with the
 * `Authorization` header on the upgrade (Node's WebSocket accepts `headers`).
 * Sends the 30 s heartbeat, reconnects with backoff, and records every token
 * message it receives.
 */

export interface TokenObservation {
  at: number;
  src: "join" | "http" | "ws";
  state: string;
  peopleAhead: number;
  queueStatus: string;
  nowServing: string | null;
}

export interface LiveStats {
  opened: number;
  messages: number;
  tokenMessages: number;
  pongs: number;
  pings: number;
  reconnects: number;
  errors: number;
}

const TERMINAL = new Set(["SERVED", "EXPIRED", "LEFT", "CANCELLED"]);

type WsCtor = new (
  url: string,
  init: { headers: Record<string, string> },
) => WebSocket;

export class LiveClient {
  readonly stats: LiveStats = {
    opened: 0,
    messages: 0,
    tokenMessages: 0,
    pongs: 0,
    pings: 0,
    reconnects: 0,
    errors: 0,
  };
  last: TokenObservation | null = null;
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private backoffMs = 1000;
  private readonly api: Api;
  private readonly path: string;
  private readonly authToken: string;
  private readonly onObservation: (o: TokenObservation) => void;

  constructor(
    api: Api,
    queueId: string,
    tokenId: string,
    authToken: string,
    onObservation: (o: TokenObservation) => void,
  ) {
    this.api = api;
    this.path = `/v1/queues/${queueId}/live?tokenId=${encodeURIComponent(tokenId)}`;
    this.authToken = authToken;
    this.onObservation = onObservation;
  }

  open(): void {
    if (this.stopped) return;
    try {
      this.api.budget.take(this.api.phase);
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        this.stopped = true;
        return;
      }
      throw e;
    }
    const Ctor = WebSocket as unknown as WsCtor;
    const ws = new Ctor(this.api.wsUrl(this.path), {
      headers: { Authorization: `Bearer ${this.authToken}` },
    });
    this.ws = ws;
    const start = performance.now();
    ws.addEventListener("open", () => {
      this.stats.opened++;
      this.backoffMs = 1000;
      this.api.metrics.record(
        "WS /queues/:id/live",
        101,
        performance.now() - start,
      );
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('{"type":"ping"}');
          this.stats.pings++;
        }
      }, 30_000);
    });
    ws.addEventListener("message", (ev) => {
      this.stats.messages++;
      let msg: { type?: string; token?: Record<string, unknown> };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "pong") {
        this.stats.pongs++;
        return;
      }
      if (msg.type === "token" && msg.token) {
        this.stats.tokenMessages++;
        const t = msg.token;
        const o: TokenObservation = {
          at: Date.now(),
          src: "ws",
          state: String(t.state),
          peopleAhead: Number(t.peopleAhead),
          queueStatus: String(t.queueStatus),
          nowServing: (t.nowServing as string | null) ?? null,
        };
        this.last = o;
        this.onObservation(o);
      }
    });
    ws.addEventListener("error", () => {
      this.stats.errors++;
    });
    ws.addEventListener("close", () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.stats.opened === 0 && this.stats.reconnects === 0) {
        this.api.metrics.record(
          "WS /queues/:id/live",
          0,
          performance.now() - start,
        );
      }
      if (this.stopped) return;
      if (this.last && TERMINAL.has(this.last.state)) return;
      this.stats.reconnects++;
      const wait = this.backoffMs;
      this.backoffMs = Math.min(30_000, this.backoffMs * 2);
      setTimeout(() => this.open(), wait);
    });
  }

  close(): void {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    try {
      this.ws?.close(1000, "done");
    } catch {
      // already closed
    }
  }
}
