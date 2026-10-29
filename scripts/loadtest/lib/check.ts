import { readFileSync } from "node:fs";
// The same lane/credit rule the QueueDO uses (dependency-free file).
import { callOrder } from "../../../packages/shared/src/priority.ts";
import type { RunConfig } from "./config.ts";
import type { Api } from "./http.ts";
import type { Signer } from "./jwt.ts";
import {
  logEvent,
  type QueueEvent,
  type SimState,
  type SimToken,
  shownViews,
  TERMINAL_STATES,
} from "./model.ts";
import { MAP_BOX } from "./sim.ts";

/** Invariant checker (brief part 5). Runs after the load phase. */

export interface Invariant {
  name: string;
  ok: boolean | null; // null = skipped
  detail: string;
  failures: string[];
}

interface DoToken {
  id: string;
  sessionId: string;
  number: number;
  series: string;
  cls: string;
  method: string;
  userId: string | null;
  state: string;
  sortKey: number;
  endReason: string | null;
  rev: number;
  peopleAhead: number | null;
  calledAt?: number | null;
  joinedAt: number;
  endedAt?: number | null;
  // Step 4 (absent from older Workers):
  peopleAheadHigh?: number | null;
  lane?: string;
  missedAt?: number | null;
  rejoined?: boolean;
  checkedInAt?: number | null;
}
interface Audit {
  do: {
    queueId: string | null;
    sessionId: string | null;
    status: string;
    waiting: number;
    pendingOutbox: number;
    tokens: DoToken[];
    /** Step 4: N and the credit counter now. */
    priority?: { enabled: boolean; perRegular: number; credits: number };
  };
  d1Tokens: {
    id: string;
    sessionId: string;
    number: number;
    series: string;
    state: string;
    rev: number;
    endReason: string | null;
  }[];
}
interface Stats {
  pushes: { tokenId: string; kind: string; count: number }[];
  analytics: {
    queueId: string;
    hourStart: number;
    joins: number;
    leaves: number;
    served: number;
    noShows: number;
    cancels: number;
  }[];
  snapshots: {
    queueId: string;
    businessId: string;
    isOpen: boolean;
    isPaused: boolean;
    waiting: number;
  }[];
  queues: {
    queueId: string;
    status: string;
    waiting: number;
    pendingOutbox: number;
  }[];
}
interface MapResponse {
  items: {
    id: string;
    queues: { id: string; waiting: number; isOpen: boolean }[];
    summary: { waiting: number };
  }[];
}

const MAX_FAILURES = 25;
const CLASS_RANK: Record<string, number> = {
  triage: 0,
  priority: 1,
  regular: 2,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function inv(name: string, failures: string[], detail: string): Invariant {
  return {
    name,
    ok: failures.length === 0,
    detail,
    failures: failures.slice(0, MAX_FAILURES),
  };
}

export interface CheckDeps {
  cfg: RunConfig;
  api: Api;
  signer: Signer;
  state: SimState;
  log: (msg: string) => void;
}

export interface CheckResult {
  invariants: Invariant[];
  ws: {
    sockets: number;
    opened: number;
    messages: number;
    tokenMessages: number;
    pongs: number;
    reconnects: number;
    errors: number;
  };
  pushesRecorded: number;
  analyticsTotals: Record<string, number>;
  tokenStates: Record<string, number>;
}

export async function checkPhase(d: CheckDeps): Promise<CheckResult> {
  const { cfg, api, signer, state } = d;
  api.phase = "check";
  const token = signer.token(`lt-${state.runId}-checker`);
  const queueIds = [...state.queues.keys()];
  const invariants: Invariant[] = [];

  const getStats = async (): Promise<Stats> => {
    const r = await api.req<Stats>(
      "GET",
      "/v1/loadtest/stats",
      "/loadtest/stats",
      token,
    );
    if (r.status !== 200) throw new Error(`stats: ${r.status} ${r.code}`);
    return r.body;
  };
  const waitDrained = async (maxMs: number) => {
    const until = Date.now() + maxMs;
    for (;;) {
      const s = await getStats();
      const pending = s.queues
        .filter((q) => state.queues.has(q.queueId))
        .reduce((a, q) => a + q.pendingOutbox, 0);
      if (pending === 0) return { stats: s, pending };
      if (Date.now() > until) return { stats: s, pending };
      await sleep(3_000);
    }
  };
  const auditAll = async (): Promise<Map<string, Audit>> => {
    const out = new Map<string, Audit>();
    for (const id of queueIds) {
      const r = await api.req<Audit>(
        "GET",
        `/v1/loadtest/queues/${id}/audit`,
        "/loadtest/queues/:id/audit",
        token,
      );
      if (r.status !== 200) throw new Error(`audit: ${r.status} ${r.code}`);
      out.set(id, r.body);
    }
    return out;
  };

  // ---------- phase A: queues still open, load stopped ----------
  d.log(`settling ${Math.round(cfg.settleMs / 1000)} s before the checks`);
  await sleep(cfg.settleMs);
  const drainA = await waitDrained(60_000);
  invariants.push(
    inv(
      "Outbox drained after the load phase (queues open)",
      drainA.pending === 0 ? [] : [`${drainA.pending} items still pending`],
      "Σ pendingOutbox over all queue DOs == 0 within 60 s",
    ),
  );
  let auditA = await auditAll();
  let mismatchA = compareD1(auditA);
  if (mismatchA.length > 0) {
    // A grace expiry may have landed between the two reads: look once more.
    await sleep(3_000);
    auditA = await auditAll();
    mismatchA = compareD1(auditA);
  }
  invariants.push(
    inv(
      "D1 tokens == DO tokens (open)",
      mismatchA,
      "every DO token has a D1 row with the same state, rev, number, series, session",
    ),
  );
  invariants.push(
    inv(
      "Numbers unique and gap-free per session + series",
      numberFailures(auditA),
      "DO and D1: numbers 1..n with no duplicates and no gaps",
    ),
  );

  const statsA = drainA.stats;
  {
    const f: string[] = [];
    for (const id of queueIds) {
      const a = auditA.get(id);
      const snap = statsA.snapshots.find((s) => s.queueId === id);
      if (!a) continue;
      if (!snap) {
        f.push(`${id}: no snapshot`);
        continue;
      }
      if (snap.waiting !== a.do.waiting) {
        f.push(`${id}: snapshot waiting ${snap.waiting} != DO ${a.do.waiting}`);
      }
      if (snap.isOpen !== (a.do.status !== "closed")) {
        f.push(`${id}: snapshot isOpen ${snap.isOpen} vs DO ${a.do.status}`);
      }
      if (snap.isPaused !== (a.do.status === "paused")) {
        f.push(
          `${id}: snapshot isPaused ${snap.isPaused} vs DO ${a.do.status}`,
        );
      }
    }
    invariants.push(
      inv(
        "Snapshot == DO after drain",
        f,
        "queue_snapshots.waiting/is_open/is_paused == DO",
      ),
    );
  }

  {
    const qs = new URLSearchParams({
      minLat: MAP_BOX.minLat.toFixed(4),
      minLng: MAP_BOX.minLng.toFixed(4),
      maxLat: MAP_BOX.maxLat.toFixed(4),
      maxLng: MAP_BOX.maxLng.toFixed(4),
      limit: "300",
    });
    const r = await api.req<MapResponse>("GET", `/v1/map?${qs}`, "/map", token);
    const f: string[] = [];
    if (r.status !== 200) f.push(`/v1/map ${r.status} ${r.code}`);
    else {
      for (const b of state.businesses) {
        const item = r.body.items.find((i) => i.id === b.id);
        if (!item) {
          f.push(`business ${b.id} missing from /v1/map`);
          continue;
        }
        const sum = item.queues.reduce((a, q) => a + q.waiting, 0);
        if (sum !== item.summary.waiting) {
          f.push(`${b.id}: summary ${item.summary.waiting} != Σ queues ${sum}`);
        }
        for (const q of item.queues) {
          const a = auditA.get(q.id);
          if (a && a.do.waiting !== q.waiting) {
            f.push(`${q.id}: map waiting ${q.waiting} != DO ${a.do.waiting}`);
          }
        }
      }
    }
    invariants.push(
      inv(
        "/v1/map summary == Σ queues == DO",
        f,
        "for every load-test business",
      ),
    );
  }

  invariants.push(
    inv(
      "DO people-ahead == rank in the call order",
      rankFailures(auditA),
      "peopleAhead of each WAITING token == its index in the lanes merged by the credit rule (shared priority.ts); high end ≥ low end (C3)",
    ),
  );

  // Sampled exact check through the public token route (quiet queue).
  {
    const f: string[] = [];
    let sampled = 0;
    for (const id of queueIds) {
      const a = auditA.get(id);
      if (!a) continue;
      const waiting = a.do.tokens.filter(
        (t) => t.state === "WAITING" && state.tokens.get(t.id)?.user,
      );
      for (const t of waiting.slice(0, 5)) {
        const sim = state.tokens.get(t.id);
        if (!sim?.user) continue;
        const r = await api.req<{ state: string; peopleAhead: number }>(
          "GET",
          `/v1/tokens/${t.id}`,
          "/tokens/:id",
          sim.user.token,
        );
        sampled++;
        if (r.status !== 200) f.push(`${t.id}: GET ${r.status}`);
        else if (r.body.peopleAhead !== t.peopleAhead) {
          f.push(
            `${t.id}: GET peopleAhead ${r.body.peopleAhead} != DO ${t.peopleAhead}`,
          );
        }
      }
    }
    invariants.push(
      inv(
        "People ahead shown to customers is exact (sample)",
        f,
        `${sampled} WAITING tokens sampled after the load stopped`,
      ),
    );
  }

  // Live sockets: the last message each socket got matches the DO.
  // auditA is a snapshot taken seconds before the sockets are read, and the DO
  // keeps changing after the load stops (grace expiries on the alarm). Step
  // 3.5 F3: a GRACE token expired between the two reads, so its socket was
  // (correctly) ahead of the snapshot. Convergence = equal once both are read
  // again: mismatching queues are re-audited after a short wait.
  {
    const compareSocket = (
      t: SimToken,
      audit: Map<string, Audit>,
    ): string | null | undefined => {
      const doTok = audit.get(t.queueId)?.do.tokens.find((x) => x.id === t.id);
      const last = t.live?.last;
      if (!doTok) return undefined; // not checked
      if (!last) return `${t.id}: socket got no token message`;
      if (last.state !== doTok.state) {
        return `${t.id}: socket state ${last.state} != DO ${doTok.state}`;
      }
      if (doTok.state === "WAITING" && last.peopleAhead !== doTok.peopleAhead) {
        return `${t.id}: socket peopleAhead ${last.peopleAhead} != DO ${doTok.peopleAhead}`;
      }
      return null;
    };
    const live = [...state.tokens.values()].filter((t) => t.live);
    let checked = 0;
    let suspects: SimToken[] = [];
    for (const t of live) {
      const r = compareSocket(t, auditA);
      if (r === undefined) continue;
      checked++;
      if (r !== null) suspects.push(t);
    }
    const f: string[] = [];
    for (let round = 0; round < 2 && suspects.length > 0; round++) {
      await sleep(3_000);
      const again = new Map<string, Audit>();
      for (const id of new Set(suspects.map((t) => t.queueId))) {
        const r = await api.req<Audit>(
          "GET",
          `/v1/loadtest/queues/${id}/audit`,
          "/loadtest/queues/:id/audit",
          token,
        );
        if (r.status === 200) again.set(id, r.body);
      }
      const still: SimToken[] = [];
      for (const t of suspects) {
        const r = compareSocket(t, again);
        if (r === undefined || r !== null) still.push(t);
        if (round === 1 && r) f.push(r);
        if (round === 1 && r === undefined) {
          f.push(`${t.id}: queue audit unavailable on re-check`);
        }
      }
      suspects = still;
    }
    invariants.push(
      inv(
        "WebSocket clients converge to the DO state",
        f,
        `${checked} sockets: last token message == DO after ${Math.round(cfg.settleMs / 1000)} s quiet`,
      ),
    );
  }

  const disturbed = disturbedTokens(state);
  invariants.push(
    inv(
      "Queue order consistent (DO and every console response)",
      orderFailures(auditA, state, disturbed),
      "triage before regular; untouched regular tokens in number order; positions 1..n",
    ),
  );
  invariants.push(
    inv(
      "People ahead never rises without a cause",
      monotonicFailures(state),
      "a rise between two observations needs a skip, triage insert or undo in that window",
    ),
  );

  // ---------- close every queue, drain, phase B ----------
  for (const q of state.queues.values()) {
    const at = Date.now();
    const r = await api.req(
      "POST",
      `/v1/queues/${q.id}/close`,
      "/queues/:id/close",
      q.ownerToken,
    );
    logEvent(state, q.id, {
      at,
      doneAt: Date.now(),
      kind: "close",
      tokenId: null,
      ok: r.status === 200,
      status: r.status,
      code: r.code,
    });
  }
  const drainB = await waitDrained(90_000);
  invariants.push(
    inv(
      "Outbox drained after close",
      drainB.pending === 0 ? [] : [`${drainB.pending} items still pending`],
      "Σ pendingOutbox == 0 within 90 s of closing",
    ),
  );
  const auditB = await auditAll();
  const statsB = await getStats();
  invariants.push(
    inv(
      "D1 tokens == DO tokens (closed)",
      compareD1(auditB),
      "after close and drain",
    ),
  );
  {
    const f: string[] = [];
    for (const [id, a] of auditB) {
      if (a.do.status !== "closed") f.push(`${id}: DO status ${a.do.status}`);
      for (const t of a.do.tokens) {
        if (!TERMINAL_STATES.has(t.state)) f.push(`${t.id}: ${t.state}`);
      }
    }
    invariants.push(
      inv(
        "Every token terminal after close",
        f,
        "no BOOKED/WAITING/CALLED/GRACE/MISSED left (MISSED never carries over, R4)",
      ),
    );
  }
  invariants.push(
    inv(
      "Credit counter fairness (PRI-06)",
      fairnessFailures(auditB),
      "per session: priority calls ≤ regular calls ÷ N + 1",
    ),
  );
  invariants.push(
    inv(
      "Terminal states never move backwards",
      backwardsFailures(state, auditB),
      `shown terminal → other state only via Undo (SERVED → CALLED within 30 s); one state per rev; ${[
        ...state.tokens.values(),
      ].reduce(
        (n, t) => n + shownViews(t.observations).ignored,
        0,
      )} late views with an older rev ignored, as the app does`,
    ),
  );

  const analyticsTotals = {
    joins: 0,
    leaves: 0,
    served: 0,
    noShows: 0,
    cancels: 0,
  };
  {
    const f: string[] = [];
    for (const [id, a] of auditB) {
      const rows = statsB.analytics.filter((r) => r.queueId === id);
      const sum = { joins: 0, leaves: 0, served: 0, noShows: 0, cancels: 0 };
      for (const r of rows) {
        sum.joins += r.joins;
        sum.leaves += r.leaves;
        sum.served += r.served;
        sum.noShows += r.noShows;
        sum.cancels += r.cancels;
      }
      for (const k of Object.keys(sum) as (keyof typeof sum)[]) {
        analyticsTotals[k] += sum[k];
      }
      const toks = a.do.tokens.filter((t) => t.sessionId === a.do.sessionId);
      const count = (pred: (t: DoToken) => boolean) => toks.filter(pred).length;
      // A Priority Pass joins the line when it checks in (Step 4).
      const simJoins =
        (state.joinsOk.get(id) ?? 0) +
        (state.triageOk.get(id) ?? 0) +
        (state.checkinsOk.get(id) ?? 0);
      // R4: every miss is a no-show — the first one (MISSED) and, after the
      // one rejoin, a second one that ends the ticket.
      const misses = toks.reduce(
        (n, t) =>
          n +
          (t.missedAt ? 1 : 0) +
          (t.rejoined && t.endReason === "no_show" ? 1 : 0),
        0,
      );
      const simLeaves = (state.events.get(id) ?? []).filter(
        (e) => e.kind === "leave" && e.ok,
      ).length;
      const expect: [string, number, number][] = [
        ["joins vs simulator log", sum.joins, simJoins],
        ["joins vs DO tokens", sum.joins, toks.length],
        ["leaves vs simulator log", sum.leaves, simLeaves],
        ["leaves vs LEFT tokens", sum.leaves, count((t) => t.state === "LEFT")],
        [
          "served vs SERVED tokens",
          sum.served,
          count((t) => t.state === "SERVED"),
        ],
        ["no-shows vs misses (R4)", sum.noShows, misses],
        ["cancels", sum.cancels, 0],
      ];
      for (const [what, got, want] of expect) {
        if (got !== want) f.push(`${id}: ${what}: analytics ${got} != ${want}`);
      }
    }
    invariants.push(
      inv(
        "Analytics hourly totals == event log",
        f,
        "Σ analytics_hourly per queue vs the simulator log and the final token states",
      ),
    );
  }

  const pushesRecorded = statsB.pushes.reduce((a, p) => a + p.count, 0);
  invariants.push(
    inv(
      "Pushes: no duplicates; every called token alerted once",
      pushFailures(state, auditB, statsB),
      "per (token, kind) from the recording sender",
    ),
  );

  {
    const f: string[] = [];
    const byKind: Record<string, number> = {};
    for (const p of state.probes) {
      byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
      if (p.status !== p.expectedStatus || p.code !== p.kind) {
        f.push(
          `${p.kind}: got ${p.status} ${p.code}, want ${p.expectedStatus} ${p.kind}`,
        );
      }
    }
    invariants.push(
      inv(
        "Rejections carry the right codes",
        f,
        Object.entries(byKind)
          .map(([k, n]) => `${k} × ${n}`)
          .join(", ") || "no probes",
      ),
    );
  }

  {
    // H2: requests that never got a connection (after the client's retries)
    // never reached the server. They are the client's network, reported on
    // their own line, and only fail the run above CLIENT_NETWORK_MAX_SHARE.
    const isClientNetwork = (u: SimState["unexpected"][number]) =>
      u.status === 0 && u.error === "connect";
    const group = (list: SimState["unexpected"]) => {
      const grouped = new Map<string, number>();
      for (const u of list) {
        const k =
          `${u.endpoint} → ${u.status} ${u.code ?? ""}${u.error ? ` (${u.error})` : ""}`.trim();
        grouped.set(k, (grouped.get(k) ?? 0) + 1);
      }
      return [...grouped].map(([k, n]) => `${k} × ${n}`);
    };
    const network = state.unexpected.filter(isClientNetwork);
    const sent = Math.max(1, api.budget.used);
    const share = network.length / sent;
    invariants.push(
      inv(
        "No unexpected responses",
        group(state.unexpected.filter((u) => !isClientNetwork(u))),
        "5xx, timeouts (status 0), broken connections on non-idempotent calls, bad bodies and unexpected error codes",
      ),
    );
    invariants.push(
      inv(
        "Client network failures stay rare",
        share > CLIENT_NETWORK_MAX_SHARE ? group(network) : [],
        `${network.length} requests never reached the server after retries (${(share * 100).toFixed(2)} % of ${sent}, limit ${CLIENT_NETWORK_MAX_SHARE * 100} %)${network.length > 0 ? `: ${group(network).join("; ")}` : ""}`,
      ),
    );
  }

  invariants.push(coordinateScan(cfg, state));

  // ---------- WebSocket totals ----------
  const ws = {
    sockets: 0,
    opened: 0,
    messages: 0,
    tokenMessages: 0,
    pongs: 0,
    reconnects: 0,
    errors: 0,
  };
  for (const t of state.tokens.values()) {
    if (!t.live) continue;
    ws.sockets++;
    const s = t.live.stats;
    ws.opened += s.opened;
    ws.messages += s.messages;
    ws.tokenMessages += s.tokenMessages;
    ws.pongs += s.pongs;
    ws.reconnects += s.reconnects;
    ws.errors += s.errors;
    t.live.close();
  }

  const tokenStates: Record<string, number> = {};
  for (const a of auditB.values()) {
    for (const t of a.do.tokens) {
      const k = t.endReason ? `${t.state} (${t.endReason})` : t.state;
      tokenStates[k] = (tokenStates[k] ?? 0) + 1;
    }
  }

  return { invariants, ws, pushesRecorded, analyticsTotals, tokenStates };
}

// ---------------------------------------------------------------------------

function compareD1(audits: Map<string, Audit>): string[] {
  const f: string[] = [];
  for (const [id, a] of audits) {
    const d1 = new Map(a.d1Tokens.map((t) => [t.id, t]));
    for (const t of a.do.tokens) {
      const r = d1.get(t.id);
      if (!r) {
        f.push(`${t.id}: missing in D1 (DO ${t.state})`);
        continue;
      }
      if (
        r.state !== t.state ||
        r.rev !== t.rev ||
        r.number !== t.number ||
        r.series !== t.series ||
        r.sessionId !== t.sessionId
      ) {
        f.push(
          `${t.id}: D1 ${r.state}/rev${r.rev} != DO ${t.state}/rev${t.rev}`,
        );
      }
      d1.delete(t.id);
    }
    // D1 rows of this session the DO doesn't know about.
    for (const r of d1.values()) {
      if (r.sessionId === a.do.sessionId) {
        f.push(`${id}: D1 token ${r.id} not in the DO`);
      }
    }
  }
  return f;
}

function numberFailures(audits: Map<string, Audit>): string[] {
  const f: string[] = [];
  const check = (
    label: string,
    rows: { number: number; series: string; sessionId: string }[],
  ) => {
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const k = `${r.sessionId}/${r.series}`;
      const list = groups.get(k) ?? [];
      list.push(r.number);
      groups.set(k, list);
    }
    for (const [k, nums] of groups) {
      // A BOOKED pass has no session or number yet (Step 4).
      if (k.startsWith("/")) continue;
      const sorted = [...nums].sort((a, b) => a - b);
      sorted.forEach((n, i) => {
        if (n !== i + 1) {
          f.push(`${label} ${k}: expected ${i + 1}, found ${n}`);
        }
      });
    }
  };
  for (const [id, a] of audits) {
    check(`${id} DO`, a.do.tokens);
    check(`${id} D1`, a.d1Tokens);
  }
  return f.slice(0, MAX_FAILURES);
}

const RANK_SPAN = 1e15;

/**
 * PRI-06/PRI-08: people ahead = index in the predicted call order — the
 * lanes (sort-key rank: triage, priority, regular) merged by the credit
 * rule, with the DO's own credits and N, through the shared `callOrder`.
 * Without priority tokens this is the old "rank by sortKey". The C3 high end
 * may only be ≥ the low end.
 */
function rankFailures(audits: Map<string, Audit>): string[] {
  const f: string[] = [];
  for (const a of audits.values()) {
    const waiting = a.do.tokens
      .filter((t) => t.state === "WAITING")
      .sort((x, y) => x.sortKey - y.sortKey);
    const lane = (r: number) =>
      waiting.filter(
        (t) => Math.min(2, Math.floor(t.sortKey / RANK_SPAN)) === r,
      );
    const order = callOrder(
      { triage: lane(0), priority: lane(1), regular: lane(2) },
      a.do.priority?.credits ?? 0,
      a.do.priority?.perRegular ?? 1,
    );
    order.forEach((t, i) => {
      if (t.peopleAhead !== i) {
        f.push(`${t.id}: peopleAhead ${t.peopleAhead}, call-order rank ${i}`);
      }
      if (
        t.peopleAheadHigh !== undefined &&
        t.peopleAheadHigh !== null &&
        t.peopleAheadHigh < (t.peopleAhead ?? 0)
      ) {
        f.push(`${t.id}: high ${t.peopleAheadHigh} < low ${t.peopleAhead}`);
      }
    });
  }
  return f;
}

/**
 * Tokens whose place was changed on purpose (skip, undo, "I'm here" rejoin)
 * — excluded from FIFO checks.
 */
function disturbedTokens(state: SimState): Set<string> {
  const s = new Set<string>();
  for (const list of state.events.values()) {
    for (const e of list) {
      if (
        (e.kind === "skip" || e.kind === "undo" || e.kind === "rejoin") &&
        e.tokenId &&
        mayHaveHappened(e)
      ) {
        s.add(e.tokenId);
      }
    }
  }
  return s;
}

/**
 * PRI-06: over a session, priority calls made while a regular was waiting ≤
 * regular calls ÷ N + 1. A priority call with no regular waiting is allowed
 * by design (`nextLane` in shared priority.ts: an idle counter calls the
 * priority head), so it is not counted (INC-066).
 */
function fairnessFailures(audits: Map<string, Audit>): string[] {
  const f: string[] = [];
  for (const [id, a] of audits) {
    const n = Math.max(1, a.do.priority?.perRegular ?? 1);
    const session = a.do.tokens.filter((t) => t.sessionId === a.do.sessionId);
    const called = session.filter(
      (t) =>
        t.state === "SERVED" || (t.calledAt ?? null) !== null || t.missedAt,
    );
    const regulars = session.filter((t) => t.cls === "regular");
    const regularWaitingAt = (at: number) =>
      regulars.some(
        (r) =>
          r.joinedAt < at &&
          (r.calledAt ?? r.endedAt ?? Number.POSITIVE_INFINITY) > at,
      );
    const contested = called.filter(
      (t) =>
        t.cls === "priority" &&
        t.calledAt != null &&
        regularWaitingAt(t.calledAt),
    ).length;
    const regular = called.filter((t) => t.cls === "regular").length;
    if (contested > Math.floor(regular / n) + 1) {
      f.push(
        `${id}: ${contested} priority calls while regulars waited vs ${regular} regular (N = ${n})`,
      );
    }
  }
  return f;
}

function orderFailures(
  audits: Map<string, Audit>,
  state: SimState,
  disturbed: Set<string>,
): string[] {
  const f: string[] = [];
  const checkList = (
    label: string,
    list: { id: string; cls: string; number: number }[],
    /** Console lists are in call order: priority and regular interleave (PRI-06). */
    callOrder = false,
  ) => {
    let rank = -1;
    let lastRegular = -1;
    let lastPriority = -1;
    for (const t of list) {
      const r = callOrder
        ? Math.min(1, CLASS_RANK[t.cls] ?? 9)
        : (CLASS_RANK[t.cls] ?? 9);
      // Passes are ordered by check-in time = their P number.
      if (t.cls === "priority" && !disturbed.has(t.id)) {
        if (t.number < lastPriority) {
          f.push(`${label}: priority P${t.number} after P${lastPriority}`);
        }
        lastPriority = Math.max(lastPriority, t.number);
      }
      // A skipped (or undo-restored) token may sit behind lower classes: skip
      // puts it behind the next 3 people, whoever they are (§23, G1). It still
      // counts for the tokens after it, so a skip that lifted a token into a
      // higher class's range is caught on the next arrival of that class.
      if (r < rank && !disturbed.has(t.id))
        f.push(`${label}: ${t.cls} #${t.number} after a lower class`);
      rank = Math.max(rank, r);
      if (t.cls === "regular" && !disturbed.has(t.id)) {
        if (t.number < lastRegular) {
          f.push(`${label}: regular #${t.number} after #${lastRegular}`);
        }
        lastRegular = Math.max(lastRegular, t.number);
      }
    }
  };
  for (const [id, a] of audits) {
    const waiting = a.do.tokens
      .filter((t) => t.state === "WAITING")
      .sort((x, y) => x.sortKey - y.sortKey);
    checkList(`${id} DO`, waiting);
  }
  for (const snap of state.consoleSnapshots) {
    snap.waiting.forEach((t, i) => {
      if (t.position !== i + 1) {
        f.push(`${snap.queueId} console: position ${t.position} at index ${i}`);
      }
    });
    checkList(`${snap.queueId} console`, snap.waiting, true);
  }
  return [...new Set(f)].slice(0, MAX_FAILURES);
}

/**
 * What may raise someone's people ahead: a skip, a triage insert, an undo,
 * and (Step 4) a rejoin inserted ahead or a Priority Pass check-in (the C3
 * low end counts holders already checked in).
 */
const CAUSES = new Set(["skip", "triage", "undo", "rejoin", "checkin"]);
const SLACK_MS = 2_000;
/** Share of requests that may fail to connect (client network) before RED. */
const CLIENT_NETWORK_MAX_SHARE = 0.01;

/**
 * A staff action whose answer was lost (status 0) may or may not have been
 * applied, so it can explain what clients saw (H2) — unless it never got a
 * connection (`connect`): then it certainly didn't happen.
 */
const mayHaveHappened = (e: QueueEvent) =>
  e.ok || (e.status === 0 && e.error !== "connect");

function monotonicFailures(state: SimState): string[] {
  const f: string[] = [];
  for (const t of state.tokens.values()) {
    const obs = shownViews(t.observations).shown;
    const events = state.events.get(t.queueId) ?? [];
    for (let i = 1; i < obs.length; i++) {
      const a = obs[i - 1];
      const b = obs[i];
      if (!a || !b || a.state !== "WAITING" || b.state !== "WAITING") continue;
      if (b.peopleAhead <= a.peopleAhead) continue;
      const explained = events.some(
        (e: QueueEvent) =>
          mayHaveHappened(e) &&
          CAUSES.has(e.kind) &&
          e.doneAt >= a.at - SLACK_MS &&
          e.at <= b.at + SLACK_MS,
      );
      if (!explained) {
        f.push(
          `${t.id}: ${a.peopleAhead} → ${b.peopleAhead} (${a.src}→${b.src}, ${b.at - a.at} ms) with no skip/triage/undo`,
        );
      }
    }
  }
  return f;
}

function backwardsFailures(
  state: SimState,
  audits: Map<string, Audit>,
): string[] {
  const f: string[] = [];
  const finalState = new Map<string, string>();
  for (const a of audits.values()) {
    for (const t of a.do.tokens) finalState.set(t.id, t.state);
  }
  for (const t of state.tokens.values()) {
    // What the app shows: late views with a lower rev are ignored (H1).
    const obs = shownViews(t.observations).shown;
    const events = state.events.get(t.queueId) ?? [];
    // Server side of H1: one rev must mean one token state, or the client's
    // "keep the highest rev" rule can't work.
    const byRev = new Map<number, string>();
    for (const o of t.observations) {
      const seen = byRev.get(o.rev);
      if (seen !== undefined && seen !== o.state) {
        f.push(`${t.id}: rev ${o.rev} seen as ${seen} and ${o.state}`);
      }
      byRev.set(o.rev, o.state);
    }
    let terminal: { state: string; at: number } | null = null;
    for (const o of obs) {
      if (terminal && o.state !== terminal.state) {
        const term = terminal;
        const undo = events.some(
          (e) =>
            mayHaveHappened(e) &&
            e.kind === "undo" &&
            e.doneAt >= term.at - SLACK_MS &&
            e.at <= o.at + SLACK_MS &&
            e.at - term.at <= 30_000 + SLACK_MS,
        );
        if (!(term.state === "SERVED" && o.state === "CALLED" && undo)) {
          f.push(`${t.id}: ${term.state} → ${o.state}`);
        }
      }
      terminal = TERMINAL_STATES.has(o.state)
        ? { state: o.state, at: o.at }
        : null;
    }
    // The final state must agree with the last terminal state a client saw,
    // unless it was undone (SERVED → CALLED) later.
    const last = obs[obs.length - 1];
    const fin = finalState.get(t.id);
    if (
      last &&
      fin &&
      TERMINAL_STATES.has(last.state) &&
      last.state !== fin &&
      last.state !== "SERVED"
    ) {
      f.push(`${t.id}: client saw ${last.state}, final ${fin}`);
    }
  }
  return f;
}

function pushFailures(
  state: SimState,
  audits: Map<string, Audit>,
  stats: Stats,
): string[] {
  const f: string[] = [];
  const counts = new Map<string, Map<string, number>>();
  for (const p of stats.pushes) {
    const m = counts.get(p.tokenId) ?? new Map<string, number>();
    m.set(p.kind, (m.get(p.kind) ?? 0) + p.count);
    counts.set(p.tokenId, m);
  }
  const doTokens = new Map<string, DoToken>();
  for (const a of audits.values()) {
    for (const t of a.do.tokens) doTokens.set(t.id, t);
  }
  type Requeues = { skips: number; undos: number; rejoins: number };
  const requeues = new Map<string, Requeues>();
  const none = (): Requeues => ({ skips: 0, undos: 0, rejoins: 0 });
  for (const list of state.events.values()) {
    for (const e of list) {
      if (!mayHaveHappened(e) || !e.tokenId) continue;
      const r = requeues.get(e.tokenId) ?? none();
      if (e.kind === "skip") r.skips++;
      if (e.kind === "undo") r.undos++;
      // Step 4: a rejoin sends the ticket back; its next call alerts again.
      if (e.kind === "rejoin") r.rejoins++;
      requeues.set(e.tokenId, r);
    }
  }

  for (const [tokenId, kinds] of counts) {
    const sim: SimToken | undefined = state.tokens.get(tokenId);
    if (!sim) {
      // Rows from an earlier run (with --no-reset) are not ours.
      if (doTokens.has(tokenId)) {
        f.push(`${tokenId}: pushes for a token the simulator doesn't know`);
      }
      continue;
    }
    if (!sim.user?.hasDevice) {
      f.push(`${tokenId}: pushes without a registered device`);
      continue;
    }
    const rq = requeues.get(tokenId) ?? none();
    for (const [kind, n] of kinds) {
      const max =
        kind === "called"
          ? 1 + rq.skips + rq.undos + rq.rejoins
          : kind === "next" || kind === "head_back"
            ? 1 + rq.skips + rq.rejoins
            : kind === "grace_started"
              ? 1 + rq.rejoins
              : 1;
      if (n > max) f.push(`${tokenId}: ${kind} × ${n} (max ${max})`);
    }
  }

  for (const sim of state.tokens.values()) {
    if (!sim.user?.hasDevice) continue;
    const t = doTokens.get(sim.id);
    if (!t) continue;
    const kinds = counts.get(sim.id) ?? new Map<string, number>();
    const called = kinds.get("called") ?? 0;
    const rq = requeues.get(sim.id) ?? none();
    const wasCalled =
      t.state === "SERVED" || t.endReason === "no_show" || Boolean(t.missedAt);
    if (wasCalled && called < 1)
      f.push(`${sim.id}: called but no 'called' push`);
    if (wasCalled && rq.skips + rq.undos + rq.rejoins === 0 && called !== 1) {
      f.push(`${sim.id}: 'called' × ${called} (want exactly 1)`);
    }
    // ALR-08: one `missed` push per ticket that became MISSED.
    if (t.missedAt && (kinds.get("missed") ?? 0) !== 1) {
      f.push(`${sim.id}: missed × ${kinds.get("missed") ?? 0} (want 1)`);
    }
    if (t.endReason === "closed" && (kinds.get("queue_closed") ?? 0) !== 1) {
      f.push(
        `${sim.id}: queue_closed × ${kinds.get("queue_closed") ?? 0} (want 1)`,
      );
    }
    const graces = kinds.get("grace_started") ?? 0;
    if (
      t.endReason === "no_show" &&
      (graces < 1 || graces > 1 + (t.rejoined ? 1 : 0))
    ) {
      f.push(
        `${sim.id}: grace_started × ${graces} (want 1${t.rejoined ? "–2" : ""})`,
      );
    }
  }
  return f;
}

/** Searches a `wrangler tail` capture for any join coordinate the simulator sent. */
function coordinateScan(cfg: RunConfig, state: SimState): Invariant {
  const name = "No coordinates in Worker logs";
  if (!cfg.tailLog) {
    return {
      name,
      ok: null,
      detail: "skipped (pass --tail-log <file> with a wrangler tail capture)",
      failures: [],
    };
  }
  let text: string;
  try {
    text = readFileSync(cfg.tailLog, "utf8");
  } catch {
    return {
      name,
      ok: false,
      detail: `cannot read ${cfg.tailLog}`,
      failures: ["tail log unreadable"],
    };
  }
  let hits = 0;
  for (const c of state.coordinates) {
    // The JSON body carries the full-precision numbers; also look for 5-decimal forms.
    for (const v of [
      String(c.lat),
      String(c.lng),
      c.lat.toFixed(5),
      c.lng.toFixed(5),
    ]) {
      if (text.includes(v)) hits++;
    }
  }
  return {
    name,
    ok: hits === 0,
    detail: `${state.coordinates.length} join points searched in ${text.length} bytes of tail output`,
    failures:
      hits === 0
        ? []
        : [`${hits} coordinate strings found (values not printed)`],
  };
}
