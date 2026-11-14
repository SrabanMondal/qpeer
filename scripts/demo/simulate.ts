/**
 * Step 5 live demo simulator (DEM-04, DEM-06).
 *
 *   node scripts/demo/simulate.ts --env demo [--queues 3] [--minutes 20]
 *        [--joins-per-min 1.5] [--next-every 45] [--queue <id> …] [--close-at-end]
 *
 * Opens one or more seeded queues and drives them through the real API, so
 * the map and the console move during a demo: simulated walk-ins join (at the
 * business pin; they are made up, nobody's real location), some leave, staff
 * call Next at a steady pace, some called people are no-shows, and now and
 * then someone takes a Priority Pass (on queues with the lane on; booked and
 * checked in through the demo helper, no Razorpay). Simulated users are
 * `demo:` accounts with no push devices, so no real phone is ever alerted.
 *
 * Stops at --minutes, at the request budget, or on Ctrl+C. Queues stay open
 * (for the demo) unless --close-at-end.
 */
import { parseArgs } from "node:util";
import { makeRng } from "../loadtest/lib/config.ts";
import { BudgetExceeded } from "../loadtest/lib/http.ts";
import { loadSigner, OWNER_SUB } from "./lib/jwt.ts";
import type { DemoQueue } from "./lib/seed.ts";
import {
  assertTarget,
  log,
  makeApi,
  must,
  resolveTarget,
  sleep,
} from "./lib/target.ts";

const { values } = parseArgs({
  options: {
    env: { type: "string" },
    local: { type: "boolean", default: false },
    "base-url": { type: "string" },
    queues: { type: "string", default: "3" },
    queue: { type: "string", multiple: true, default: [] },
    minutes: { type: "string", default: "20" },
    "joins-per-min": { type: "string", default: "1.5" },
    "next-every": { type: "string", default: "45" },
    "no-show": { type: "string", default: "0.08" },
    leave: { type: "string", default: "0.07" },
    pass: { type: "string", default: "0.05" },
    budget: { type: "string", default: "2500" },
    seed: { type: "string" },
    "close-at-end": { type: "boolean", default: false },
    key: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(
    "node scripts/demo/simulate.ts --env dev|demo | --local [--queues 3 | --queue <id> …] [--minutes 20] [--joins-per-min 1.5] [--next-every 45] [--no-show 0.08] [--leave 0.07] [--pass 0.05] [--budget 2500] [--close-at-end]",
  );
  process.exit(0);
}

function num(name: string, v: string, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) {
    throw new Error(`--${name} must be between ${lo} and ${hi}`);
  }
  return n;
}

interface ConsoleAnswer {
  serving: { id: string; label: string }[];
  counts: { waiting: number };
}

const stats = {
  joins: 0,
  passes: 0,
  leaves: 0,
  nexts: 0,
  noShows: 0,
  rejected: 0,
};

async function main() {
  const minutes = num("minutes", values.minutes, 1, 240);
  const joinsPerMin = num("joins-per-min", values["joins-per-min"], 0.1, 20);
  const nextEvery = num("next-every", values["next-every"], 5, 600);
  const noShow = num("no-show", values["no-show"], 0, 0.5);
  const leave = num("leave", values.leave, 0, 0.5);
  const pass = num("pass", values.pass, 0, 0.5);
  const target = resolveTarget({
    env: values.env,
    local: values.local,
    baseUrl: values["base-url"],
  });
  const api = makeApi(target, num("budget", values.budget, 10, 20_000));
  const signer = loadSigner(values.key);
  const seed = values.seed ? Number(values.seed) : Date.now() % 1_000_000;
  const rng = makeRng(seed);
  const runId = `${Date.now().toString(36)}${rng.int(10, 99)}`;
  const env = await assertTarget(api, target);
  const owner = signer.token(OWNER_SUB, { registered: true });

  const all = must(
    await api.req<{ queues: DemoQueue[] }>(
      "GET",
      "/v1/demo/queues",
      "/demo/queues",
      owner,
    ),
    "list demo queues",
  ).queues;
  if (all.length === 0) {
    throw new Error("No demo queues: run scripts/demo/seed.ts first.");
  }
  const picked =
    values.queue.length > 0
      ? all.filter((q) => values.queue.includes(q.id))
      : all.slice(0, num("queues", values.queues, 1, all.length));
  if (picked.length === 0)
    throw new Error("None of the --queue ids is a demo queue.");

  log(
    `simulate → ${target.baseUrl.origin} (env ${env}), run ${runId}, ${picked.length} queues, ${minutes} min, seed ${seed}`,
  );
  for (const q of picked) {
    const r = await api.req(
      "POST",
      `/v1/queues/${q.id}/open`,
      "/queues/:id/open",
      owner,
    );
    if (r.status !== 200 && r.status !== 409) must(r, `open ${q.name}`);
    log(`open: ${q.businessName} · ${q.name}`);
  }

  const stop = new AbortController();
  process.once("SIGINT", () => {
    log("stopping (Ctrl+C)…");
    stop.abort();
  });
  const deadline = Date.now() + minutes * 60_000;
  const timer = setTimeout(() => stop.abort(), minutes * 60_000);
  const pause = async (ms: number) => {
    const end = Math.min(Date.now() + ms, deadline);
    while (!stop.signal.aborted && Date.now() < end) {
      await sleep(Math.min(1_000, end - Date.now()));
    }
  };
  const side: Promise<void>[] = [];
  let userN = 0;

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        if (!stop.signal.aborted) log("request budget used up: stopping");
        stop.abort();
        return;
      }
      throw e;
    }
  };

  const customers = (q: DemoQueue) =>
    guard(async () => {
      while (!stop.signal.aborted) {
        // Exponential gaps: joins arrive like real people, not on a beat.
        await pause((-Math.log(1 - rng.next()) / joinsPerMin) * 60_000);
        if (stop.signal.aborted) break;
        userN++;
        const sub = `sim-${runId}-${userN}`;
        if (q.priorityEnabled && rng.chance(pass)) {
          const tok = signer.token(sub, { registered: true });
          const r = await api.req(
            "POST",
            `/v1/demo/queues/${q.id}/priority-pass`,
            "/demo/queues/:id/priority-pass",
            tok,
          );
          if (r.status === 201) stats.passes++;
          else stats.rejected++;
          continue;
        }
        const tok = signer.token(sub);
        const r = await api.req<{ id: string }>(
          "POST",
          `/v1/queues/${q.id}/join`,
          "/queues/:id/join",
          tok,
          // A made-up walk-in standing at the (made-up) business pin.
          { lat: q.lat, lng: q.lng, accuracyM: 12, mocked: false },
        );
        if (r.status !== 201 && r.status !== 200) {
          stats.rejected++;
          continue;
        }
        stats.joins++;
        if (rng.chance(leave)) {
          const tokenId = r.body.id;
          const wait = rng.between(60_000, 8 * 60_000);
          side.push(
            guard(async () => {
              await pause(wait);
              if (stop.signal.aborted) return;
              const l = await api.req(
                "POST",
                `/v1/tokens/${tokenId}/leave`,
                "/tokens/:id/leave",
                tok,
              );
              // 409: already called or served meanwhile (fine in a demo)
              if (l.status === 200) stats.leaves++;
              else stats.rejected++;
            }),
          );
        }
      }
    });

  const staff = (q: DemoQueue) =>
    guard(async () => {
      let called: string | null = null;
      while (!stop.signal.aborted) {
        await pause(nextEvery * 1_000 * rng.between(0.6, 1.4));
        if (stop.signal.aborted) break;
        const base = `/v1/queues/${q.id}`;
        if (called && rng.chance(noShow)) {
          const r = await api.req(
            "POST",
            `${base}/tokens/${called}/no-show`,
            "/queues/:id/tokens/:tid/no-show",
            owner,
          );
          if (r.status === 200) stats.noShows++;
          called = null;
        }
        const r = await api.req<ConsoleAnswer>(
          "POST",
          `${base}/next`,
          "/queues/:id/next",
          owner,
        );
        if (r.status === 200) {
          stats.nexts++;
          called = r.body.serving[0]?.id ?? null;
        }
      }
    });

  const report = setInterval(() => {
    log(
      `joins ${stats.joins}, passes ${stats.passes}, leaves ${stats.leaves}, nexts ${stats.nexts}, no-shows ${stats.noShows}, rejected ${stats.rejected}, requests ${api.budget.used}`,
    );
  }, 60_000);

  await Promise.all(picked.flatMap((q) => [customers(q), staff(q)]));
  await Promise.all(side);
  clearInterval(report);
  clearTimeout(timer);

  if (values["close-at-end"]) {
    for (const q of picked) {
      await guard(async () => {
        await api.req(
          "POST",
          `/v1/queues/${q.id}/close`,
          "/queues/:id/close",
          owner,
        );
      });
    }
    log("queues closed");
  }
  log(
    `done: joins ${stats.joins}, passes ${stats.passes}, leaves ${stats.leaves}, nexts ${stats.nexts}, no-shows ${stats.noShows}, rejected ${stats.rejected}, ${api.budget.used} requests`,
  );
  for (const e of api.metrics.summary()) {
    log(
      `  ${e.endpoint}: ${e.count} × p95 ${e.p95} ms ${JSON.stringify(e.statuses)}`,
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
