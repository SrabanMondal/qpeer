import type { Rng, RunConfig } from "./config.ts";
import { type Api, BudgetExceeded } from "./http.ts";
import type { Signer } from "./jwt.ts";
import { LiveClient, type TokenObservation } from "./live.ts";
import {
  type ConsoleSnapshot,
  logEvent,
  type ProbeKind,
  type QueueEventKind,
  type SimQueue,
  type SimState,
  type SimToken,
  type SimUser,
  shownLast,
  TERMINAL_STATES,
} from "./model.ts";

/** Jammu city centre; business pins are spread ±0.02° (~2 km) around it. */
export const JAMMU = { lat: 32.7266, lng: 74.857 };
export const MAP_BOX = {
  minLat: JAMMU.lat - 0.25,
  maxLat: JAMMU.lat + 0.25,
  minLng: JAMMU.lng - 0.25,
  maxLng: JAMMU.lng + 0.25,
};
const M_PER_DEG = 111_320;
/** Loadtest queue settings: 1-minute grace so expiries happen inside a run. */
const QUEUE_SETTINGS = {
  graceMinutes: 1,
  joinRadiusM: 150,
  maxSize: 500,
  triageDailyCap: 5,
  counters: 1,
};

interface ConsoleToken {
  id: string;
  number: number;
  cls: string;
  state: string;
  position: number | null;
  calledAt: number | null;
}
interface ConsoleState {
  status: string;
  serving: ConsoleToken[];
  waiting: ConsoleToken[];
  grace: ConsoleToken[];
}
interface TokenView {
  id: string;
  number: number;
  series: string;
  state: string;
  peopleAhead: number;
  queueStatus: string;
  nowServing: string | null;
  rev: number;
}

const sleep = (ms: number, stop: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (stop.aborted) return resolve();
    const t = setTimeout(done, Math.max(0, ms));
    function done() {
      clearTimeout(t);
      stop.removeEventListener("abort", done);
      resolve();
    }
    stop.addEventListener("abort", done, { once: true });
  });

function offsetPoint(
  from: { lat: number; lng: number },
  meters: number,
  angle: number,
) {
  const dLat = (meters * Math.cos(angle)) / M_PER_DEG;
  const dLng =
    (meters * Math.sin(angle)) /
    (M_PER_DEG * Math.cos((from.lat * Math.PI) / 180));
  return { lat: from.lat + dLat, lng: from.lng + dLng };
}

const observe = (v: TokenView, src: TokenObservation["src"]) => ({
  at: Date.now(),
  src,
  state: v.state,
  peopleAhead: v.peopleAhead,
  queueStatus: v.queueStatus,
  nowServing: v.nowServing,
  rev: v.rev,
});

export interface SimDeps {
  cfg: RunConfig;
  api: Api;
  signer: Signer;
  rng: Rng;
  state: SimState;
  log: (msg: string) => void;
}

/** Business pin per queue (in memory only, never logged). */
const pins = new Map<string, { lat: number; lng: number }>();

/** Owners create businesses (pins around Jammu) and queues, then open them. */
export async function setup(d: SimDeps): Promise<void> {
  const { cfg, api, signer, rng, state } = d;
  for (let b = 0; b < cfg.businesses; b++) {
    const sub = `lt-${state.runId}-owner${b}`;
    const ownerToken = signer.token(sub, {
      registered: true,
      phone: `+9188${String(b).padStart(8, "0")}`,
    });
    const pin = {
      lat: JAMMU.lat + rng.between(-0.02, 0.02),
      lng: JAMMU.lng + rng.between(-0.02, 0.02),
    };
    const biz = await api.req<{ id: string }>(
      "POST",
      "/v1/businesses",
      "/businesses",
      ownerToken,
      {
        name: `Loadtest ${state.runId} #${b + 1}`,
        category: "clinic",
        address: "Jammu (load test)",
        location: pin,
      },
    );
    if (biz.status !== 201 && biz.status !== 200) {
      throw new Error(`create business failed: ${biz.status} ${biz.code}`);
    }
    const business = {
      id: biz.body.id,
      ownerToken,
      pin,
      queues: [] as SimQueue[],
    };
    for (let q = 0; q < cfg.queuesPerBusiness; q++) {
      const qr = await api.req<{ id: string }>(
        "POST",
        `/v1/businesses/${business.id}/queues`,
        "/businesses/:id/queues",
        ownerToken,
        { name: `Counter ${q + 1}`, settings: QUEUE_SETTINGS },
      );
      if (qr.status !== 201 && qr.status !== 200) {
        throw new Error(`create queue failed: ${qr.status} ${qr.code}`);
      }
      const queue: SimQueue = {
        id: qr.body.id,
        businessId: business.id,
        ownerToken,
        paused: false,
        lastNextAt: 0,
        lastCalledId: null,
      };
      const at = Date.now();
      const open = await api.req(
        "POST",
        `/v1/queues/${queue.id}/open`,
        "/queues/:id/open",
        ownerToken,
      );
      if (open.status !== 200) {
        throw new Error(`open queue failed: ${open.status} ${open.code}`);
      }
      logEvent(state, queue.id, {
        at,
        doneAt: Date.now(),
        kind: "open",
        tokenId: null,
        ok: true,
        status: 200,
        code: null,
      });
      business.queues.push(queue);
      state.queues.set(queue.id, queue);
      pins.set(queue.id, pin);
    }
    state.businesses.push(business);
  }
  d.log(
    `setup: ${state.businesses.length} businesses, ${state.queues.size} queues open`,
  );
}

/** Runs customers, staff loops and map pollers until the duration or budget ends. */
export async function loadPhase(d: SimDeps): Promise<{ stoppedBy: string }> {
  const { cfg, rng, state } = d;
  const ctl = new AbortController();
  const stop = ctl.signal;
  const deadline = Date.now() + cfg.durationMs;
  let stoppedBy = "duration";
  const scale = Math.min(1, Math.max(0.15, cfg.durationMs / 300_000));
  const tasks: Promise<void>[] = [];

  const guard = (p: Promise<void>) =>
    tasks.push(
      p.catch((e) => {
        if (e instanceof BudgetExceeded) {
          if (!stop.aborted) {
            stoppedBy = "budget";
            d.log("request budget reached: hard stop of the load phase");
            ctl.abort();
          }
          return;
        }
        d.log(`actor error: ${e instanceof Error ? e.message : String(e)}`);
      }),
    );

  const queues = [...state.queues.values()];
  for (const q of queues) guard(staffLoop(d, q, stop, scale));
  for (let m = 0; m < cfg.mapClients; m++) {
    guard(mapPoller(d, m, stop, scale));
  }

  // Customers: one burst on the first queue at 10% of the run, the rest spread
  // over the first 75%.
  const burst = Math.min(30, Math.floor(cfg.customers * 0.2));
  const firstQueue = queues[0];
  for (let i = 0; i < cfg.customers; i++) {
    const inBurst = i < burst && firstQueue !== undefined;
    const startAt = inBurst
      ? cfg.durationMs * 0.1
      : rng.between(0, cfg.durationMs * 0.75);
    const queue = inBurst ? firstQueue : rng.pick(queues);
    const isProbe = !inBurst && rng.chance(cfg.probeShare);
    const plan = {
      i,
      queue,
      startAt,
      isProbe,
      probe: rng.pick<ProbeKind>([
        "too_far",
        "mock_location",
        "no_location_fix",
      ]),
      registered: rng.chance(cfg.registeredShare),
      device: rng.chance(cfg.deviceShare),
      ws: rng.chance(cfg.wsShare),
      doubleJoin: rng.chance(0.03),
      leaveAfter: rng.chance(cfg.leaveShare)
        ? rng.between(0.1, 0.5) * cfg.durationMs
        : null,
      pollEvery: Math.max(10_000, 40_000 * scale) * rng.between(0.8, 1.2),
      distance: rng.between(0, 60),
      angle: rng.between(0, Math.PI * 2),
      accuracy: rng.between(5, 30),
    };
    guard(
      (async () => {
        await sleep(plan.startAt, stop);
        if (stop.aborted) return;
        await customer(d, plan, stop);
      })(),
    );
  }

  await sleep(deadline - Date.now(), stop);
  if (!stop.aborted) ctl.abort();
  await Promise.all(tasks);
  return { stoppedBy };
}

interface CustomerPlan {
  i: number;
  queue: SimQueue;
  isProbe: boolean;
  probe: ProbeKind;
  registered: boolean;
  device: boolean;
  ws: boolean;
  doubleJoin: boolean;
  leaveAfter: number | null;
  pollEvery: number;
  distance: number;
  angle: number;
  accuracy: number;
}

async function customer(d: SimDeps, p: CustomerPlan, stop: AbortSignal) {
  const { api, signer, state } = d;
  const sub = `lt-${state.runId}-c${p.i}`;
  const user: SimUser = {
    sub,
    token: signer.token(
      sub,
      p.registered
        ? { registered: true, phone: `+9190${String(p.i).padStart(8, "0")}` }
        : {},
    ),
    registered: p.registered,
    hasDevice: false,
  };
  if (p.device) {
    const register = () =>
      api.req("POST", "/v1/me/devices", "/me/devices", user.token, {
        expoPushToken: `ExponentPushToken[lt-${state.runId}-${p.i}]`,
        platform: "android",
      });
    let r = await register();
    if (r.status === 0) {
      lostAnswer(state, "POST /me/devices", r);
      r = await register(); // idempotent upsert: the app re-registers too
    }
    user.hasDevice = r.status === 200;
    if (r.status !== 200) unexpected(state, "POST /me/devices", r);
  }
  const pin = pins.get(p.queue.id);
  if (!pin) return;

  if (p.isProbe) {
    const body =
      p.probe === "too_far"
        ? { ...offsetPoint(pin, 5_000, p.angle), accuracyM: 10, mocked: false }
        : p.probe === "mock_location"
          ? {
              ...offsetPoint(pin, p.distance, p.angle),
              accuracyM: 10,
              mocked: true,
            }
          : {
              ...offsetPoint(pin, p.distance, p.angle),
              accuracyM: 5_000,
              mocked: false,
            };
    state.coordinates.push({ lat: body.lat, lng: body.lng });
    const r = await api.req(
      "POST",
      `/v1/queues/${p.queue.id}/join`,
      "/queues/:id/join",
      user.token,
      body,
    );
    // A paused/closed queue answers 409 before the location check.
    if (r.code === "queue_paused") {
      state.pausedRejections++;
      return;
    }
    state.probes.push({
      kind: p.probe,
      expectedStatus: 422,
      status: r.status,
      code: r.code,
    });
    return;
  }

  const point = offsetPoint(pin, p.distance, p.angle);
  state.coordinates.push(point);
  const body = { ...point, accuracyM: p.accuracy, mocked: false };
  let view: TokenView | null = null;
  // First answer lost (status 0): the request may have created a token. The
  // app's "Try again" re-sends the join; the server answers 409
  // already_in_queue with the token id, and the app opens that ticket. Do the
  // same, once, so a lost answer never leaves a token the simulator can't see.
  let lostRetry = false;
  for (let attempt = 0; attempt < 3 && !stop.aborted; attempt++) {
    const at = Date.now(); // the lost request's start, when retried below
    let r = await api.req<TokenView>(
      "POST",
      `/v1/queues/${p.queue.id}/join`,
      "/queues/:id/join",
      user.token,
      body,
    );
    if (r.status === 0 && !lostRetry) {
      lostRetry = true;
      lostAnswer(state, "POST /queues/:id/join", r);
      r = await api.req<TokenView>(
        "POST",
        `/v1/queues/${p.queue.id}/join`,
        "/queues/:id/join",
        user.token,
        body,
      );
      if (r.status === 201) state.joinRetries.recovered++;
      if (r.code === "already_in_queue") {
        const tokenId = (r.body as { details?: { tokenId?: unknown } } | null)
          ?.details?.tokenId;
        const g =
          typeof tokenId === "string"
            ? await api.req<TokenView>(
                "GET",
                `/v1/tokens/${tokenId}`,
                "/tokens/:id",
                user.token,
              )
            : null;
        if (g?.status === 200) {
          state.joinRetries.recovered++;
          state.joinRetries.viaAlreadyInQueue++;
          // The token was created by the first (lost) request.
          r = { ...g, status: 201 };
        }
      }
    }
    if (r.status === 201) {
      view = r.body;
      logEvent(state, p.queue.id, {
        at,
        doneAt: Date.now(),
        kind: "join",
        tokenId: view.id,
        ok: true,
        status: 201,
        code: null,
      });
      state.joinsOk.set(p.queue.id, (state.joinsOk.get(p.queue.id) ?? 0) + 1);
      break;
    }
    if (r.code === "queue_paused") {
      state.pausedRejections++;
      await sleep(5_000 + attempt * 5_000, stop);
      continue;
    }
    if (r.code === "queue_full") state.fullRejections++;
    else unexpected(state, "POST /queues/:id/join", r);
    return;
  }
  if (!view) return;

  const tok: SimToken = {
    id: view.id,
    queueId: p.queue.id,
    user,
    number: view.number,
    series: view.series,
    joinedAt: Date.now(),
    observations: [observe(view, "join")],
    live: null,
    leftOk: false,
  };
  state.tokens.set(tok.id, tok);

  if (p.doubleJoin) {
    const r = await api.req(
      "POST",
      `/v1/queues/${p.queue.id}/join`,
      "/queues/:id/join",
      user.token,
      body,
    );
    if (r.code !== "queue_paused") {
      state.probes.push({
        kind: "already_in_queue",
        expectedStatus: 409,
        status: r.status,
        code: r.code,
      });
    }
  }

  if (p.ws) {
    tok.live = new LiveClient(api, p.queue.id, tok.id, user.token, (o) =>
      tok.observations.push(o),
    );
    tok.live.open();
  }

  let leaveAt = p.leaveAfter === null ? null : tok.joinedAt + p.leaveAfter;
  let nextPoll = tok.live ? null : Date.now() + p.pollEvery;
  while (!stop.aborted) {
    const last = shownLast(tok.observations);
    if (last && TERMINAL_STATES.has(last.state)) return;
    const wakeAt = Math.min(
      leaveAt ?? Number.POSITIVE_INFINITY,
      nextPoll ?? Number.POSITIVE_INFINITY,
    );
    if (wakeAt === Number.POSITIVE_INFINITY) return; // live socket only
    await sleep(wakeAt - Date.now(), stop);
    if (stop.aborted) return;

    if (leaveAt !== null && Date.now() >= leaveAt) {
      leaveAt = null;
      // Only a waiting customer leaves (a called one walks up instead).
      if (shownLast(tok.observations)?.state === "WAITING") {
        const at = Date.now();
        const r = await api.req<TokenView>(
          "POST",
          `/v1/tokens/${tok.id}/leave`,
          "/tokens/:id/leave",
          user.token,
        );
        logEvent(state, p.queue.id, {
          at,
          doneAt: Date.now(),
          kind: "leave",
          tokenId: tok.id,
          ok: r.status === 200,
          status: r.status,
          code: r.code,
        });
        if (r.status === 200) {
          tok.leftOk = true;
          tok.observations.push(observe(r.body, "http"));
          return;
        }
        if (r.code !== "invalid_state") {
          unexpected(state, "POST /tokens/:id/leave", r);
        }
      }
    }

    if (nextPoll !== null && Date.now() >= nextPoll) {
      const r = await api.req<TokenView>(
        "GET",
        `/v1/tokens/${tok.id}`,
        "/tokens/:id",
        user.token,
      );
      if (r.status === 200) tok.observations.push(observe(r.body, "http"));
      else unexpected(state, "GET /tokens/:id", r);
      nextPoll = Date.now() + p.pollEvery;
    }
  }
}

function unexpected(
  state: SimState,
  endpoint: string,
  r: { status: number; code: string | null; error?: string | null },
) {
  state.unexpected.push({
    endpoint,
    status: r.status,
    code: r.code,
    error: r.error ?? null,
  });
}

/**
 * A request sent without an answer before a retry. A timeout still counts as
 * unexpected (the server was too slow, even if the retry recovers); a broken
 * connection is the client's network and is only visible through the retry.
 */
function lostAnswer(
  state: SimState,
  endpoint: string,
  r: { status: number; code: string | null; error?: string | null },
) {
  if (r.error === "timeout") unexpected(state, endpoint, r);
}

/** Staff loop of one queue: Next at random 5–40 s (scaled), with the other console actions mixed in. */
async function staffLoop(
  d: SimDeps,
  q: SimQueue,
  stop: AbortSignal,
  scale: number,
) {
  const { api, rng, state } = d;
  let consoleState: ConsoleState | null = null;
  const side: Promise<void>[] = [];

  const act = async (
    kind: QueueEventKind,
    method: string,
    path: string,
    endpoint: string,
    tokenId: string | null,
    body?: unknown,
  ) => {
    const at = Date.now();
    const r = await api.req<
      ConsoleState & { console?: ConsoleState; token?: TokenView }
    >(method, path, endpoint, q.ownerToken, body);
    const ok =
      (r.status === 200 || r.status === 201) &&
      r.body !== null &&
      typeof r.body === "object";
    const cs: ConsoleState | null = ok
      ? (r.body.console ?? (r.body as ConsoleState))
      : null;
    let eventToken = tokenId;
    if (cs) {
      consoleState = cs;
      q.paused = cs.status === "paused";
      recordConsole(state, q.id, cs);
      if (kind === "next") {
        const called = [...cs.serving].sort(
          (a, b) => (b.calledAt ?? 0) - (a.calledAt ?? 0),
        )[0];
        eventToken = called?.id ?? null;
        q.lastCalledId = eventToken;
        q.lastNextAt = at;
      }
      if (kind === "triage" && r.body.token) {
        const t = r.body.token;
        eventToken = t.id;
        state.triageOk.set(q.id, (state.triageOk.get(q.id) ?? 0) + 1);
        state.tokens.set(t.id, {
          id: t.id,
          queueId: q.id,
          user: null,
          number: t.number,
          series: t.series,
          joinedAt: Date.now(),
          observations: [observe(t, "join")],
          live: null,
          leftOk: false,
        });
      }
    } else if (
      r.code !== "invalid_state" &&
      r.code !== "quota_full" &&
      r.code !== "queue_paused"
    ) {
      unexpected(state, `${method} ${endpoint}`, r);
    }
    logEvent(state, q.id, {
      at,
      doneAt: Date.now(),
      kind,
      tokenId: eventToken,
      ok,
      status: r.status,
      code: r.code,
      // A lost answer (status 0, not `connect`) may still have been applied:
      // the checker treats such a skip/undo/Next as possibly done (H2). The
      // loop keeps its last console state; the next answer replaces it.
      error: r.error,
    });
    return ok;
  };

  const base = `/v1/queues/${q.id}`;
  while (!stop.aborted) {
    await sleep(rng.between(5_000, 40_000) * scale, stop);
    if (stop.aborted) break;
    const cs = consoleState as ConsoleState | null;
    const called = cs?.serving[0] ?? null;
    const roll = rng.next();
    if (roll < 0.04) {
      if (
        await act("pause", "POST", `${base}/pause`, "/queues/:id/pause", null)
      ) {
        await sleep(rng.between(3_000, 12_000) * scale, stop);
        await act(
          "resume",
          "POST",
          `${base}/resume`,
          "/queues/:id/resume",
          null,
        );
      }
    } else if (roll < 0.12 && called) {
      const ok = await act(
        "no-show",
        "POST",
        `${base}/tokens/${called.id}/no-show`,
        "/queues/:id/tokens/:tid/no-show",
        called.id,
      );
      if (ok && rng.chance(0.5)) {
        const wait = rng.between(5_000, 40_000) * scale;
        side.push(
          (async () => {
            await sleep(wait, stop);
            if (stop.aborted) return;
            await act(
              "admit",
              "POST",
              `${base}/tokens/${called.id}/admit`,
              "/queues/:id/tokens/:tid/admit",
              called.id,
            );
          })(),
        );
      }
    } else if (roll < 0.17 && called) {
      await act(
        "served",
        "POST",
        `${base}/tokens/${called.id}/served`,
        "/queues/:id/tokens/:tid/served",
        called.id,
      );
    } else if (roll < 0.22 && cs && cs.waiting.length >= 2) {
      const target = rng.pick(cs.waiting);
      await act(
        "skip",
        "POST",
        `${base}/tokens/${target.id}/skip`,
        "/queues/:id/tokens/:tid/skip",
        target.id,
      );
    } else if (roll < 0.26) {
      await act("triage", "POST", `${base}/triage`, "/queues/:id/triage", null);
    } else {
      const ok = await act(
        "next",
        "POST",
        `${base}/next`,
        "/queues/:id/next",
        null,
        {},
      );
      if (ok && q.lastCalledId && rng.chance(0.12)) {
        await sleep(rng.between(1_000, 5_000), stop);
        if (stop.aborted) break;
        await act(
          "undo",
          "POST",
          `${base}/undo-next`,
          "/queues/:id/undo-next",
          q.lastCalledId,
        );
      }
    }
  }
  await Promise.all(side);
}

function recordConsole(state: SimState, queueId: string, cs: ConsoleState) {
  const snap: ConsoleSnapshot = {
    queueId,
    at: Date.now(),
    status: cs.status,
    waiting: cs.waiting.map((t) => ({
      id: t.id,
      position: t.position,
      cls: t.cls,
      number: t.number,
    })),
  };
  state.consoleSnapshots.push(snap);
}

/** A map screen: polls the Jammu box every ~30 s (scaled). */
async function mapPoller(
  d: SimDeps,
  m: number,
  stop: AbortSignal,
  scale: number,
) {
  const { api, signer, rng, state } = d;
  const token = signer.token(`lt-${state.runId}-map${m}`);
  const qs = new URLSearchParams({
    minLat: MAP_BOX.minLat.toFixed(4),
    minLng: MAP_BOX.minLng.toFixed(4),
    maxLat: MAP_BOX.maxLat.toFixed(4),
    maxLng: MAP_BOX.maxLng.toFixed(4),
  });
  await sleep(rng.between(0, 10_000) * scale, stop);
  while (!stop.aborted) {
    const r = await api.req("GET", `/v1/map?${qs}`, "/map", token);
    state.mapPolls++;
    if (r.status !== 200) unexpected(state, "GET /map", r);
    await sleep(Math.max(10_000, 30_000 * scale) * rng.between(0.9, 1.1), stop);
  }
}
