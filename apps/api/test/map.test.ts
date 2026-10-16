import { env } from "cloudflare:workers";
import {
  type BusinessCategory,
  BusinessView,
  ConsoleState,
  defaultWeeklyHours,
  MapQuery,
  MapResponse,
  QueueInfoResponse,
  QueueSettings,
  QueueView,
  type WeeklyHours,
} from "@qpeer/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "../src/db/client";
import {
  businesses,
  businessMembers,
  queueSnapshots,
  queues,
} from "../src/db/schema";
import {
  SEED_BUSINESS_PREFIX,
  SEED_NAME_PREFIX,
  SEED_OWNER_ID,
} from "../src/modules/dev/seed-map";
import { mapQuery, mapSql } from "../src/modules/map/service";
import { expectError, expectOk, makeTestApi } from "./helpers";

type Api = Awaited<ReturnType<typeof makeTestApi>>;

const DAY = 24 * 3_600_000;
const HOUR = 3_600_000;
const JAMMU = { lat: 32.7266, lng: 74.857 };

let api: Api;
let owner: string;
let other: string;
let anon: string;

beforeAll(async () => {
  api = await makeTestApi();
  owner = await api.token({ sub: "map-owner" });
  other = await api.token({ sub: "map-other" });
  anon = await api.token({ sub: "map-anon", anonymous: true });
});

/** Epoch ms of an IST wall-clock time. Month is 1-based. */
function ist(y: number, mo: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, mo - 1, d, h, mi) - 5.5 * HOUR;
}

/** Runs `fn` with the API clock at `t`, then puts it back. */
async function at<T>(t: number, fn: () => Promise<T>): Promise<T> {
  const saved = api.clock.t;
  api.clock.t = t;
  try {
    return await fn();
  } finally {
    api.clock.t = saved;
  }
}

/**
 * Each test uses its own empty area far from Jammu (other test files only
 * create businesses at Jammu), so results never mix.
 */
function area(n: number) {
  const lat = 8 + n * 0.5;
  const lng = 70;
  return {
    at: (dLat = 0, dLng = 0) => ({ lat: lat + dLat, lng: lng + dLng }),
    query: (extra: Record<string, string | number> = {}) => {
      const p = new URLSearchParams({
        minLat: String(lat - 0.1),
        maxLat: String(lat + 0.1),
        minLng: String(lng - 0.1),
        maxLng: String(lng + 0.1),
        ...Object.fromEntries(
          Object.entries(extra).map(([k, v]) => [k, String(v)]),
        ),
      });
      return `/v1/map?${p}`;
    },
  };
}

interface SeedSnapshot {
  isOpen: boolean;
  isPaused?: boolean;
  waiting: number;
  low: number | null;
  high: number | null;
}

/** Direct D1 rows: a business with queues (and optional snapshots). */
async function insertBusiness(o: {
  location: { lat: number; lng: number } | null;
  name?: string;
  category?: BusinessCategory;
  status?: "active" | "inactive";
  hours?: WeeklyHours;
  queues?: { status?: "active" | "archived"; snapshot?: SeedSnapshot }[];
}) {
  const id = crypto.randomUUID();
  const now = new Date(api.clock.t);
  const d = db(env.DB);
  await d.insert(businesses).values({
    id,
    ownerUserId: "someone-else",
    name: o.name ?? "Map Biz",
    category: o.category ?? "clinic",
    address: "Somewhere",
    lat: o.location?.lat ?? null,
    lng: o.location?.lng ?? null,
    geohash: null,
    hoursJson: o.hours ?? defaultWeeklyHours(),
    status: o.status ?? "active",
    createdAt: now,
    updatedAt: now,
  });
  const queueIds: string[] = [];
  for (const [i, q] of (o.queues ?? [{}]).entries()) {
    const qid = crypto.randomUUID();
    queueIds.push(qid);
    await d.insert(queues).values({
      id: qid,
      businessId: id,
      name: `Q${i + 1}`,
      status: q.status ?? "active",
      settingsJson: QueueSettings.parse({}),
      settingsVersion: 1,
      createdAt: new Date(now.getTime() + i),
      updatedAt: now,
    });
    if (q.snapshot && o.location) {
      await d.insert(queueSnapshots).values({
        queueId: qid,
        businessId: id,
        lat: o.location.lat,
        lng: o.location.lng,
        isOpen: q.snapshot.isOpen,
        isPaused: q.snapshot.isPaused ?? false,
        waiting: q.snapshot.waiting,
        etaLowMs: q.snapshot.low,
        etaHighMs: q.snapshot.high,
        nowServing: null,
        updatedAt: now,
      });
    }
  }
  return { id, queueIds };
}

async function getMap(path: string, tok = anon) {
  return expectOk(await api.call("GET", path, tok), 200, MapResponse);
}

async function createListed(
  tok: string,
  location: { lat: number; lng: number },
  settings?: Record<string, number>,
) {
  const biz = await expectOk(
    await api.call("POST", "/v1/businesses", tok, {
      name: "Stats Clinic",
      category: "clinic",
      location,
    }),
    201,
    BusinessView,
  );
  const queue = await expectOk(
    await api.call("POST", `/v1/businesses/${biz.id}/queues`, tok, {
      name: "OPD",
      ...(settings ? { settings } : {}),
    }),
    201,
    QueueView,
  );
  return { biz, queue };
}

describe("GET /v1/map (MAP-01…04)", () => {
  it("MAP-01/02: box filter, only listed businesses, snapshot values and summary", async () => {
    const a = area(1);
    const listed = await insertBusiness({
      location: a.at(0.01, 0.01),
      name: "Listed",
      queues: [
        { snapshot: { isOpen: true, waiting: 3, low: 600_000, high: 900_000 } },
        {
          snapshot: {
            isOpen: true,
            isPaused: true,
            waiting: 2,
            low: 60_000,
            high: 120_000,
          },
        },
        { snapshot: { isOpen: true, waiting: 1, low: 300_000, high: 420_000 } },
        { status: "archived" },
      ],
    });
    const neverOpened = await insertBusiness({
      location: a.at(-0.02, 0.03),
      name: "Never opened",
    });
    await insertBusiness({ location: a.at(), status: "inactive" });
    await insertBusiness({
      location: a.at(),
      queues: [{ status: "archived" }],
    });
    await insertBusiness({ location: null });
    await insertBusiness({ location: a.at(0.11, 0) }); // just outside the box
    await insertBusiness({ location: a.at(0, -0.11) });

    const res = await getMap(a.query());
    expect(res.truncated).toBe(false);
    expect(res.serverTime).toBe(api.clock.t);
    expect(res.items.map((b) => b.id).sort()).toEqual(
      [listed.id, neverOpened.id].sort(),
    );

    const b = res.items.find((x) => x.id === listed.id);
    expect(b?.name).toBe("Listed");
    expect(b?.location).toEqual(a.at(0.01, 0.01));
    // archived queue excluded; order = queue creation order
    expect(b?.queues.map((q) => q.id)).toEqual(listed.queueIds.slice(0, 3));
    expect(b?.queues[0]).toMatchObject({
      name: "Q1",
      isOpen: true,
      isPaused: false,
      waiting: 3,
      waitLowMs: 600_000,
      waitHighMs: 900_000,
      updatedAt: api.clock.t,
    });
    expect(b?.queues[1]).toMatchObject({ isPaused: true, waiting: 2 });
    // summary: total waiting; shortest wait among open, not paused queues
    expect(b?.summary).toEqual({
      waiting: 6,
      waitLowMs: 300_000,
      waitHighMs: 420_000,
      anyOpen: true,
    });

    const n = res.items.find((x) => x.id === neverOpened.id);
    expect(n?.queues[0]).toMatchObject({
      isOpen: false,
      isPaused: false,
      waiting: 0,
      waitLowMs: null,
      updatedAt: null,
    });
    expect(n?.summary).toEqual({
      waiting: 0,
      waitLowMs: null,
      waitHighMs: null,
      anyOpen: false,
    });
    // nothing user-specific in the payload
    expect(JSON.stringify(res)).not.toMatch(/myRole|ownerUserId|phone/);
  });

  it("MAP-02: a queue opened through the API shows its live snapshot", async () => {
    const a = area(2);
    const { biz, queue } = await createListed(owner, a.at());
    await expectOk(
      await api.call("POST", `/v1/queues/${queue.id}/open`, owner),
      200,
      ConsoleState,
    );
    const res = await getMap(a.query());
    expect(res.items).toHaveLength(1);
    expect(res.items[0].id).toBe(biz.id);
    expect(res.items[0].queues[0]).toMatchObject({
      id: queue.id,
      isOpen: true,
      waiting: 0,
    });
    expect(res.items[0].queues[0].updatedAt).not.toBeNull();
    expect(res.items[0].summary.anyOpen).toBe(true);
  });

  it("MAP-01: truncated flag with limit; nearest to the box centre first", async () => {
    const a = area(3);
    const near = await insertBusiness({ location: a.at(0.001, 0) });
    const mid = await insertBusiness({ location: a.at(0.03, 0.03) });
    const far = await insertBusiness({ location: a.at(-0.09, 0.09) });
    // A business with several queues still counts once toward the limit.
    await db(env.DB)
      .insert(queues)
      .values({
        id: crypto.randomUUID(),
        businessId: near.id,
        name: "Extra",
        status: "active",
        settingsJson: QueueSettings.parse({}),
        settingsVersion: 1,
        createdAt: new Date(api.clock.t + 10),
        updatedAt: new Date(api.clock.t),
      });

    const two = await getMap(a.query({ limit: 2 }));
    expect(two.truncated).toBe(true);
    expect(two.items.map((b) => b.id)).toEqual([near.id, mid.id]);
    expect(two.items[0].queues).toHaveLength(2);

    const three = await getMap(a.query({ limit: 3 }));
    expect(three.truncated).toBe(false);
    expect(three.items.map((b) => b.id)).toEqual([near.id, mid.id, far.id]);
  });

  it("MAP-04: category filter", async () => {
    const a = area(4);
    const lab = await insertBusiness({ location: a.at(), category: "lab" });
    await insertBusiness({ location: a.at(0.01, 0), category: "salon" });
    const res = await getMap(a.query({ category: "lab" }));
    expect(res.items.map((b) => b.id)).toEqual([lab.id]);
    expect(res.items[0].category).toBe("lab");
    await expectError(
      await api.call("GET", a.query({ category: "bakery" }), anon),
      400,
      "invalid_input",
    );
  });

  it("MAP-04: openNow uses the business hours in IST (controlled clock)", async () => {
    const a = area(5);
    const morning: WeeklyHours = {
      ...defaultWeeklyHours(),
      mon: [
        { from: "09:00", to: "13:00" },
        { from: "17:00", to: "21:00" },
      ],
    };
    const evening: WeeklyHours = {
      ...defaultWeeklyHours(),
      mon: [{ from: "13:00", to: "23:00" }],
    };
    const closedMonday: WeeklyHours = { ...defaultWeeklyHours(), mon: [] };
    const m = await insertBusiness({ location: a.at(), hours: morning });
    const e = await insertBusiness({ location: a.at(0.01, 0), hours: evening });
    const c = await insertBusiness({
      location: a.at(0.02, 0),
      hours: closedMonday,
    });
    const ids = (r: MapResponse) => r.items.map((b) => b.id).sort();

    // Monday 2026-10-12, 12:59 IST: only the morning range is open.
    await at(ist(2026, 10, 12, 12, 59), async () => {
      const all = await getMap(a.query());
      expect(ids(all)).toEqual([m.id, e.id, c.id].sort());
      const open = new Map(all.items.map((b) => [b.id, b.isOpenNow]));
      expect(open.get(m.id)).toBe(true);
      expect(open.get(e.id)).toBe(false);
      expect(open.get(c.id)).toBe(false);
      expect(ids(await getMap(a.query({ openNow: 1 })))).toEqual([m.id]);
    });
    // 13:00 IST: the end minute is closed, the next range's start is open.
    await at(ist(2026, 10, 12, 13, 0), async () => {
      expect(ids(await getMap(a.query({ openNow: 1 })))).toEqual([e.id]);
    });
    // 17:30 IST: both open; with category and limit applied after the filter.
    await at(ist(2026, 10, 12, 17, 30), async () => {
      expect(ids(await getMap(a.query({ openNow: 1 })))).toEqual(
        [m.id, e.id].sort(),
      );
      const one = await getMap(a.query({ openNow: 1, limit: 1 }));
      expect(one.items.map((b) => b.id)).toEqual([m.id]);
      expect(one.truncated).toBe(true);
    });
    // Tuesday 00:30 IST (Monday 19:00 UTC): Tuesday's default hours, all closed.
    await at(ist(2026, 10, 13, 0, 30), async () => {
      expect(ids(await getMap(a.query({ openNow: 1 })))).toEqual([]);
      expect(ids(await getMap(a.query({ openNow: 0 })))).toHaveLength(3);
    });
  });

  it("MAP-01: rejects invalid and too-large boxes; anonymous users allowed, no token 401", async () => {
    const a = area(6);
    for (const path of [
      "/v1/map",
      "/v1/map?minLat=1&minLng=1&maxLat=2",
      "/v1/map?minLat=10&minLng=70&maxLat=11.6&maxLng=70.5",
      "/v1/map?minLat=10&minLng=70&maxLat=10.5&maxLng=71.6",
      "/v1/map?minLat=11&minLng=70&maxLat=10&maxLng=70.5",
      "/v1/map?minLat=x&minLng=70&maxLat=10&maxLng=70.5",
      `${a.query({ limit: 301 })}`,
      `${a.query({ limit: 0 })}`,
      `${a.query({ openNow: "yes" })}`,
      `${a.query({ zoom: 3 })}`,
    ]) {
      await expectError(
        await api.call("GET", path, anon),
        400,
        "invalid_input",
      );
    }
    await getMap(a.query(), anon);
    await expectError(
      await api.call("GET", a.query(), null),
      401,
      "unauthorized",
    );
  });

  it("NFR-04: the map is one D1 statement", async () => {
    const a = area(7);
    await insertBusiness({ location: a.at(), queues: [{}, {}] });
    await insertBusiness({ location: a.at(0.01, 0.01) });
    let prepares = 0;
    const counting = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (q: string) => {
            prepares++;
            return target.prepare(q);
          };
        }
        if (prop === "batch" || prop === "exec") {
          throw new Error(`unexpected ${String(prop)}`);
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const q = MapQuery.parse({
      ...Object.fromEntries(new URL(`http://x${a.query()}`).searchParams),
      openNow: "1",
      category: "clinic",
    });
    const res = await mapQuery(counting, q, api.clock.t);
    expect(res.items).toHaveLength(2);
    expect(prepares).toBe(1);

    // The box filter reads businesses through idx(status, lat, lng), not a scan.
    const { sql, params } = mapSql(q, api.clock.t);
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((r) => r.detail).join("\n");
    expect(details).toMatch(
      /SEARCH biz USING INDEX businesses_status_lat_lng_idx/,
    );
    expect(details).not.toMatch(/SCAN biz|SCAN businesses/);
  });

  it("NFR-04: 220 listed businesses in view → 200 items, truncated, under 1 s", async () => {
    const a = area(8);
    const now = new Date(api.clock.t);
    const bRows: (typeof businesses.$inferInsert)[] = [];
    const qRows: (typeof queues.$inferInsert)[] = [];
    for (let i = 0; i < 220; i++) {
      const id = crypto.randomUUID();
      const loc = a.at(
        (i % 20) * 0.009 - 0.09,
        Math.floor(i / 20) * 0.016 - 0.09,
      );
      bRows.push({
        id,
        ownerUserId: "bulk",
        name: `Bulk ${i}`,
        category: "clinic",
        address: "",
        lat: loc.lat,
        lng: loc.lng,
        hoursJson: defaultWeeklyHours(),
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      qRows.push({
        id: crypto.randomUUID(),
        businessId: id,
        name: "OPD",
        status: "active",
        settingsJson: QueueSettings.parse({}),
        settingsVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    const d = db(env.DB);
    // D1 allows 100 bound variables per statement: insert in chunks of 5.
    for (let i = 0; i < 220; i += 5) {
      await d.batch([
        d.insert(businesses).values(bRows.slice(i, i + 5)),
        d.insert(queues).values(qRows.slice(i, i + 5)),
      ]);
    }
    const start = Date.now();
    const res = await getMap(a.query());
    const ms = Date.now() - start;
    expect(res.items).toHaveLength(200);
    expect(res.truncated).toBe(true);
    expect(ms).toBeLessThan(1000);
  });
});

describe("Public business detail (MAP-05, MAP-06)", () => {
  async function addAnalytics(
    businessId: string,
    queueId: string,
    hourStart: number,
    r: Partial<Record<string, number>>,
  ) {
    const now = api.clock.t;
    await env.DB.prepare(
      `INSERT INTO analytics_hourly (queue_id, business_id, hour_start, joins, leaves, served, no_shows, cancels,
         sum_wait_ms, waits, sum_interval_ms, intervals, eta_hits, eta_total, created_at, updated_at)
       VALUES (?, ?, ?, 0, 0, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        queueId,
        businessId,
        hourStart,
        r.served ?? 0,
        r.sumWaitMs ?? 0,
        r.waits ?? 0,
        r.sumIntervalMs ?? 0,
        r.intervals ?? 0,
        r.etaHits ?? 0,
        r.etaTotal ?? 0,
        now,
        now,
      )
      .run();
  }

  const detail = async (id: string, tok: string) =>
    expectOk(
      await api.call("GET", `/v1/businesses/${id}`, tok),
      200,
      BusinessView,
    );

  it("MAP-05: stats math over the last 28 days from analytics_hourly", async () => {
    const { biz, queue } = await createListed(owner, area(9).at());
    const now = api.clock.t;
    const hour = Math.floor(now / HOUR) * HOUR;
    await addAnalytics(biz.id, queue.id, hour - 2 * HOUR, {
      served: 15,
      sumWaitMs: 15 * 600_000,
      waits: 15,
      sumIntervalMs: 12 * 240_000,
      intervals: 12,
      etaHits: 10,
      etaTotal: 15,
    });
    await addAnalytics(biz.id, queue.id, hour - 27 * DAY, {
      served: 10,
      sumWaitMs: 10 * 1_200_000,
      waits: 10,
      sumIntervalMs: 10 * 360_000,
      intervals: 10,
      etaHits: 8,
      etaTotal: 10,
    });
    // outside the 28-day window: ignored
    await addAnalytics(biz.id, queue.id, hour - 29 * DAY, {
      served: 1000,
      sumWaitMs: 1000 * 99_000_000,
      waits: 1000,
      sumIntervalMs: 1000,
      intervals: 1000,
      etaHits: 0,
      etaTotal: 1000,
    });

    const v = await detail(biz.id, owner);
    expect(v.stats).toEqual({
      windowDays: 28,
      servedCount: 25,
      avgWaitMs: Math.round((15 * 600_000 + 10 * 1_200_000) / 25), // 840 000
      avgServiceMs: Math.round((12 * 240_000 + 10 * 360_000) / 22),
      etaAccuracyPct: Math.round((18 / 25) * 100), // 72
    });
  });

  it("MAP-05: too little data → null averages, served count still given", async () => {
    const { biz, queue } = await createListed(owner, area(10).at());
    await addAnalytics(biz.id, queue.id, api.clock.t - 3 * HOUR, {
      served: 19,
      sumWaitMs: 19 * 60_000,
      waits: 19,
      sumIntervalMs: 19 * 60_000,
      intervals: 19,
      etaHits: 19,
      etaTotal: 19,
    });
    const v = await detail(biz.id, owner);
    expect(v.stats).toEqual({
      windowDays: 28,
      servedCount: 19,
      avgWaitMs: null,
      avgServiceMs: null,
      etaAccuracyPct: null,
    });
  });

  it("MAP-06: stats hidden from non-members before 14 days unless the owner opts in; members always see them", async () => {
    const { biz } = await createListed(owner, area(11).at());

    const pub = await detail(biz.id, other);
    expect(pub.stats).toBeNull();
    expect(pub.publicStats).toBeUndefined(); // the opt-in itself is members-only
    expect(pub.myRole).toBeNull();
    const own = await detail(biz.id, owner);
    expect(own.stats).not.toBeNull();
    expect(own.publicStats).toBe(false);

    // 13 days later: still hidden; 14 days: visible.
    await at(api.clock.t + 13 * DAY, async () => {
      expect((await detail(biz.id, anon)).stats).toBeNull();
    });
    await at(api.clock.t + 14 * DAY, async () => {
      expect((await detail(biz.id, anon)).stats).toMatchObject({
        windowDays: 28,
      });
    });

    // Owner opt-in shows them at once; turning it off hides them again.
    const on = await expectOk(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, {
        publicStats: true,
      }),
      200,
      BusinessView,
    );
    expect(on.publicStats).toBe(true);
    expect((await detail(biz.id, other)).stats).not.toBeNull();
    await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, {
      publicStats: false,
    });
    expect((await detail(biz.id, other)).stats).toBeNull();
  });

  it("MAP-06: the 14-day clock starts when the business is first listed, not when it was created", async () => {
    const biz = await expectOk(
      await api.call("POST", "/v1/businesses", owner, {
        name: "Late Listed",
        category: "lab",
        location: area(12).at(),
      }),
      201,
      BusinessView,
    );
    const created = api.clock.t;
    await at(created + 20 * DAY, async () => {
      await expectOk(
        await api.call("POST", `/v1/businesses/${biz.id}/queues`, owner, {
          name: "Samples",
        }),
        201,
        QueueView,
      );
    });
    await at(created + 33 * DAY, async () => {
      expect((await detail(biz.id, other)).stats).toBeNull(); // listed 13 days
    });
    await at(created + 34 * DAY, async () => {
      expect((await detail(biz.id, other)).stats).not.toBeNull();
    });
  });

  it("IDOR: only the owner can set publicStats (non-member 404, staff 403, anonymous 403)", async () => {
    const { biz } = await createListed(owner, area(13).at());
    const staffTok = await api.token({ sub: "map-staff" });
    const staffMe = (await (
      await api.call("GET", "/v1/me", staffTok)
    ).json()) as {
      user: { id: string };
    };
    await db(env.DB).insert(businessMembers).values({
      businessId: biz.id,
      userId: staffMe.user.id,
      role: "staff",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expectError(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, other, {
        publicStats: true,
      }),
      404,
      "not_found",
    );
    await expectError(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, staffTok, {
        publicStats: true,
      }),
      403,
      "forbidden",
    );
    await expectError(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, anon, {
        publicStats: true,
      }),
      403,
      "registration_required",
    );
    const v = await detail(biz.id, owner);
    expect(v.publicStats).toBe(false);
    expect((await detail(biz.id, other)).stats).toBeNull();
    // staff are members: they see their own stats
    expect((await detail(biz.id, staffTok)).stats).not.toBeNull();
    await expectError(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, {
        publicStats: "yes",
      }),
      400,
      "invalid_input",
    );
  });

  it("MAP-05: public view carries isOpenNow and today's hours (IST)", async () => {
    const { biz } = await createListed(owner, area(14).at());
    // default hours: Mon–Sat 09:00–18:00, Sunday closed
    await at(ist(2026, 10, 16, 17, 59), async () => {
      const v = await detail(biz.id, other);
      expect(v.isOpenNow).toBe(true);
      expect(v.todayHours).toEqual({
        day: "fri",
        ranges: [{ from: "09:00", to: "18:00" }],
        text: "9:00 AM – 6:00 PM",
      });
    });
    await at(ist(2026, 10, 16, 18, 0), async () => {
      expect((await detail(biz.id, other)).isOpenNow).toBe(false);
    });
    await at(ist(2026, 10, 18, 11, 0), async () => {
      const v = await detail(biz.id, other);
      expect(v.isOpenNow).toBe(false);
      expect(v.todayHours.text).toBe("Closed today");
    });
  });
});

describe("Public queue view: joinRadiusM (deferred from Step 2)", () => {
  it("non-members see joinRadiusM but no fees or other settings", async () => {
    const { queue } = await createListed(owner, area(15).at(), {
      joinRadiusM: 250,
      reservationFeePaise: 3500,
    });
    const res = await api.call("GET", `/v1/queues/${queue.id}`, other);
    const raw = await res.clone().text();
    const info = await expectOk(res, 200, QueueInfoResponse);
    expect(info.joinRadiusM).toBe(250);
    expect(info.myRole).toBeNull();
    expect(info.queue.settings).toBeUndefined();
    expect(raw).not.toMatch(/FeePaise|walkinQuotaPct|maxSize|settings/);

    const mine = await expectOk(
      await api.call("GET", `/v1/queues/${queue.id}`, owner),
      200,
      QueueInfoResponse,
    );
    expect(mine.joinRadiusM).toBe(250);
    expect(mine.queue.settings?.reservationFeePaise).toBe(3500);
  });
});

describe("Dev map seed", () => {
  const jammuBox = () => {
    const p = new URLSearchParams({
      minLat: String(JAMMU.lat - 0.07),
      maxLat: String(JAMMU.lat + 0.07),
      minLng: String(JAMMU.lng - 0.07),
      maxLng: String(JAMMU.lng + 0.07),
      limit: "300",
    });
    return `/v1/map?${p}`;
  };
  const seededCount = async () =>
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM businesses WHERE id LIKE ?",
      )
        .bind(`${SEED_BUSINESS_PREFIX}%`)
        .first<{ n: number }>()
    )?.n;

  it("seed is idempotent, listed on the map, owned by the seed user; unseed removes exactly them", async () => {
    const SeedResult = z.object({
      businesses: z.number(),
      queues: z.number(),
      created: z.number(),
    });
    // An unrelated business near Jammu must survive unseed.
    const keep = await insertBusiness({ location: JAMMU, name: "Keep me" });

    const first = await expectOk(
      await api.call("POST", "/v1/dev/seed-map", owner),
      200,
      SeedResult,
    );
    expect(first).toEqual({ businesses: 8, queues: 11, created: 8 });
    const again = await expectOk(
      await api.call("POST", "/v1/dev/seed-map", other),
      200,
      SeedResult,
    );
    expect(again).toEqual({ businesses: 8, queues: 11, created: 0 });
    expect(await seededCount()).toBe(8);
    const qCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM queues WHERE id LIKE '5eed0001-%'",
    ).first<{ n: number }>();
    expect(qCount?.n).toBe(11);
    const owners = await env.DB.prepare(
      "SELECT DISTINCT user_id FROM business_members WHERE business_id LIKE ?",
    )
      .bind(`${SEED_BUSINESS_PREFIX}%`)
      .all<{ user_id: string }>();
    expect(owners.results.map((r) => r.user_id)).toEqual([SEED_OWNER_ID]);

    const map = await getMap(jammuBox());
    const demo = map.items.filter((b) => b.id.startsWith(SEED_BUSINESS_PREFIX));
    expect(demo).toHaveLength(8);
    for (const b of demo) {
      expect(b.name.startsWith(SEED_NAME_PREFIX)).toBe(true);
      expect(b.queues.every((q) => q.isOpen)).toBe(true);
    }
    expect(new Set(demo.map((b) => b.category)).size).toBeGreaterThan(3);
    // the caller is not a member
    const detail = await expectOk(
      await api.call("GET", `/v1/businesses/${demo[0].id}`, owner),
      200,
      BusinessView,
    );
    expect(detail.myRole).toBeNull();

    await expectOk(
      await api.call("POST", "/v1/dev/unseed-map", owner),
      200,
      z.object({ businesses: z.literal(8) }),
    );
    expect(await seededCount()).toBe(0);
    const left = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM queues WHERE id LIKE '5eed0001-%') + (SELECT COUNT(*) FROM queue_snapshots WHERE queue_id LIKE '5eed0001-%') + (SELECT COUNT(*) FROM business_members WHERE business_id LIKE '5eed0000-%') AS n",
    ).first<{ n: number }>();
    expect(left?.n).toBe(0);
    const after = await getMap(jammuBox());
    expect(after.items.some((b) => b.id.startsWith(SEED_BUSINESS_PREFIX))).toBe(
      false,
    );
    expect(after.items.some((b) => b.id === keep.id)).toBe(true);
  });

  it("seed needs a registered user; dev routes are 404 in demo", async () => {
    await expectError(
      await api.call("POST", "/v1/dev/seed-map", anon),
      403,
      "registration_required",
    );
    for (const path of ["/v1/dev/seed-map", "/v1/dev/unseed-map"]) {
      const res = await api.app.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${owner}` },
        }),
        { ...env, ENVIRONMENT: "demo" },
      );
      await expectError(res, 404, "not_found");
    }
    expect(await seededCount()).toBe(0);
  });
});
