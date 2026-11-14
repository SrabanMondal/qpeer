import { env } from "cloudflare:workers";
import {
  type AnalyticsHourRow,
  AnalyticsResponse,
  BusinessView,
  buildAnalytics,
  type DemoQueueProfile,
  type EarningsEvent,
  EarningsResponse,
  emptySums,
  generateDemoHistory,
  QueueView,
} from "@qpeer/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { expectError, expectOk, makeTestApi } from "./helpers";

type Api = Awaited<ReturnType<typeof makeTestApi>>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Epoch ms of an IST wall-clock time. Month is 1-based. */
function ist(y: number, mo: number, d: number, h = 0, mi = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi) - 5.5 * HOUR;
}

/** Thursday 12 Nov 2026, 3:30 PM IST. */
const NOW = ist(2026, 11, 12, 15, 30);

let api: Api;
let owner: string;
let staff: string;
let stranger: string;
let anon: string;

beforeAll(async () => {
  api = await makeTestApi();
  api.clock.t = NOW;
  owner = await api.token({ sub: "ins-owner" });
  staff = await api.token({ sub: "ins-staff" });
  stranger = await api.token({ sub: "ins-stranger" });
  anon = await api.token({ sub: "ins-anon", anonymous: true });
  // create the users
  for (const t of [owner, staff, stranger, anon]) {
    await api.call("GET", "/v1/me", t);
  }
});

async function createBusiness(name = "Insights Clinic", queues = ["OPD"]) {
  const biz = await expectOk(
    await api.call("POST", "/v1/businesses", owner, {
      name,
      category: "clinic",
      location: { lat: 32.73, lng: 74.86 },
    }),
    201,
    BusinessView,
  );
  const qs: QueueView[] = [];
  for (const n of queues) {
    qs.push(
      await expectOk(
        await api.call("POST", `/v1/businesses/${biz.id}/queues`, owner, {
          name: n,
        }),
        201,
        QueueView,
      ),
    );
  }
  return { biz, queues: qs };
}

async function addStaff(businessId: string, sub: string) {
  const u = await env.DB.prepare("SELECT id FROM users WHERE firebase_uid = ?")
    .bind(sub)
    .first<{ id: string }>();
  await env.DB.prepare(
    "INSERT INTO business_members (business_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'staff', 0, 0)",
  )
    .bind(businessId, u?.id)
    .run();
}

/** Multi-row literal inserts (test data only). */
async function insertRows(
  table: string,
  cols: string[],
  rows: (string | number | null)[][],
) {
  const q = (v: string | number | null) =>
    v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v}'`;
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    await env.DB.prepare(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES ${chunk
        .map((r) => `(${r.map(q).join(", ")})`)
        .join(",")}`,
    ).run();
  }
}

async function addAnalytics(
  rows: (AnalyticsHourRow & { queueId: string; businessId: string })[],
) {
  await insertRows(
    "analytics_hourly",
    [
      "queue_id",
      "business_id",
      "hour_start",
      "joins",
      "leaves",
      "served",
      "no_shows",
      "cancels",
      "sum_wait_ms",
      "waits",
      "sum_interval_ms",
      "intervals",
      "eta_hits",
      "eta_total",
      "created_at",
      "updated_at",
    ],
    rows.map((r) => [
      r.queueId,
      r.businessId,
      r.hourStart,
      r.joins,
      r.leaves,
      r.served,
      r.noShows,
      r.cancels,
      r.sumWaitMs,
      r.waits,
      r.sumIntervalMs,
      r.intervals,
      r.etaHits,
      r.etaTotal,
      0,
      0,
    ]),
  );
}

const analytics = (id: string, tok: string, qs = "") =>
  api.call("GET", `/v1/businesses/${id}/analytics${qs}`, tok);
const earnings = (id: string, tok: string, qs = "") =>
  api.call("GET", `/v1/businesses/${id}/earnings${qs}`, tok);

describe("Insights access (owner/staff only, IDOR-safe)", () => {
  it("non-members get 404, anonymous 403, staff see analytics but not earnings", async () => {
    const { biz } = await createBusiness("Access Clinic");
    await addStaff(biz.id, "ins-staff");
    await expectError(await analytics(biz.id, stranger), 404, "not_found");
    await expectError(await earnings(biz.id, stranger), 404, "not_found");
    await expectError(
      await analytics("no-such-business", owner),
      404,
      "not_found",
    );
    await expectError(
      await analytics(biz.id, anon),
      403,
      "registration_required",
    );
    await expectOk(await analytics(biz.id, staff), 200, AnalyticsResponse);
    await expectError(await earnings(biz.id, staff), 403, "forbidden");
    await expectOk(await earnings(biz.id, owner), 200, EarningsResponse);
  });

  it("a queue of another business is 404 (never its data)", async () => {
    const a = await createBusiness("A Clinic");
    const b = await createBusiness("B Clinic");
    const other = b.queues[0]?.id ?? "";
    await expectError(
      await analytics(a.biz.id, owner, `?queueId=${other}`),
      404,
      "not_found",
    );
  });

  it("INS-01: range must be 7 or 28; unknown params are refused", async () => {
    const { biz } = await createBusiness("Range Clinic");
    await expectError(
      await analytics(biz.id, owner, "?range=14"),
      400,
      "invalid_input",
    );
    await expectError(
      await earnings(biz.id, owner, "?range=7&x=1"),
      400,
      "invalid_input",
    );
    await expectError(
      await earnings(biz.id, owner, "?cursor=garbage"),
      400,
      "invalid_input",
    );
  });
});

describe("GET /v1/businesses/:id/analytics (INS-01…06, INS-08)", () => {
  it("INS-08: a new business has no data and says nothing", async () => {
    const { biz, queues } = await createBusiness("New Clinic");
    const r = await expectOk(
      await analytics(biz.id, owner),
      200,
      AnalyticsResponse,
    );
    expect(r).toMatchObject({
      hasData: false,
      firstDataAt: null,
      rangeDays: 7,
      queueId: null,
      insights: [],
    });
    expect(r.queues.map((q) => q.id)).toEqual(queues.map((q) => q.id));
    expect(r.days).toHaveLength(7);
    expect(r.totals.joins).toBe(0);
  });

  it("matches the shared math, per business and per queue", async () => {
    const { biz, queues } = await createBusiness("Math Clinic", ["OPD", "Lab"]);
    const [q1, q2] = queues.map((q) => q.id) as [string, string];
    const profiles: DemoQueueProfile[] = [q1, q2].map((queueId, i) => ({
      queueId,
      businessId: biz.id,
      category: "clinic",
      hours: {
        mon: [{ from: "09:00", to: "18:00" }],
        tue: [{ from: "09:00", to: "18:00" }],
        wed: [{ from: "09:00", to: "18:00" }],
        thu: [{ from: "09:00", to: "18:00" }],
        fri: [{ from: "09:00", to: "18:00" }],
        sat: [{ from: "09:00", to: "13:00" }],
        sun: [],
      },
      baseJoinsPerHour: 5 + i,
      serviceMin: 5,
      reservationFeePaise: 2000,
      priorityFeePaise: null,
      priorityCancelRefundPct: 50,
    }));
    const h = generateDemoHistory(profiles, {
      now: NOW,
      weeks: 8,
      seed: "api-test",
      businessSharePct: 70,
      paymentIdPrefix: "x-",
      customerUserId: "c",
    });
    await addAnalytics(h.analytics);

    const all = await expectOk(
      await analytics(biz.id, owner, "?range=28"),
      200,
      AnalyticsResponse,
    );
    const expected = buildAnalytics(sumByHour(h.analytics), {
      now: NOW,
      rangeDays: 28,
    });
    expect(all.hasData).toBe(true);
    expect(all.firstDataAt).toBe(
      Math.min(...h.analytics.map((r) => r.hourStart)),
    );
    expect(all.totals).toEqual(expected.totals);
    expect(all.previous).toEqual(expected.previous);
    expect(all.days).toEqual(expected.days);
    expect(all.peak).toEqual(expected.peak);
    expect(all.insights).toEqual(expected.insights);
    expect(all.insights.length).toBeGreaterThan(0);

    const one = await expectOk(
      await analytics(biz.id, owner, `?range=7&queueId=${q2}`),
      200,
      AnalyticsResponse,
    );
    const only = buildAnalytics(
      h.analytics.filter((r) => r.queueId === q2),
      { now: NOW, rangeDays: 7 },
    );
    expect(one.queueId).toBe(q2);
    expect(one.totals).toEqual(only.totals);
    expect(one.days).toEqual(only.days);
  });

  it("stays fast on 8 weeks × 24 h × 5 queues", async () => {
    const { biz, queues } = await createBusiness("Busy Clinic", [
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
    const start = ist(2026, 9, 17);
    const rows: (AnalyticsHourRow & { queueId: string; businessId: string })[] =
      [];
    for (const q of queues) {
      for (let t = start; t + HOUR <= NOW; t += HOUR) {
        rows.push({
          ...emptySums(),
          queueId: q.id,
          businessId: biz.id,
          hourStart: t,
          joins: 3,
          served: 3,
          waits: 3,
          sumWaitMs: 3 * 600_000,
        });
      }
    }
    expect(rows.length).toBeGreaterThan(6500);
    await addAnalytics(rows);
    const t0 = Date.now();
    const r = await expectOk(
      await analytics(biz.id, owner, "?range=28"),
      200,
      AnalyticsResponse,
    );
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(1500);
    // 27 whole days + today's 15 finished hours, 5 queues, 3 joins each
    expect(r.totals.joins).toBe((27 * 24 + 15) * 5 * 3);
    expect(r.totals.avgWaitMs).toBe(600_000);
  });
});

function sumByHour(
  rows: (AnalyticsHourRow & { queueId: string })[],
): AnalyticsHourRow[] {
  const m = new Map<number, AnalyticsHourRow>();
  for (const r of rows) {
    const cur = m.get(r.hourStart) ?? {
      ...emptySums(),
      hourStart: r.hourStart,
    };
    for (const k of Object.keys(emptySums()) as (keyof ReturnType<
      typeof emptySums
    >)[]) {
      cur[k] += r[k];
    }
    m.set(r.hourStart, cur);
  }
  return [...m.values()];
}

describe("GET /v1/businesses/:id/earnings (INS-07)", () => {
  it("totals reconcile with ledger_entries and with the paged list", async () => {
    const { biz, queues } = await createBusiness("Money Clinic");
    const queueId = queues[0]?.id ?? "";
    const h = generateDemoHistory(
      [
        {
          queueId,
          businessId: biz.id,
          category: "clinic",
          hours: {
            mon: [{ from: "09:00", to: "18:00" }],
            tue: [{ from: "09:00", to: "18:00" }],
            wed: [{ from: "09:00", to: "18:00" }],
            thu: [{ from: "09:00", to: "18:00" }],
            fri: [{ from: "09:00", to: "18:00" }],
            sat: [{ from: "09:00", to: "18:00" }],
            sun: [{ from: "09:00", to: "18:00" }],
          },
          baseJoinsPerHour: 8,
          serviceMin: 5,
          reservationFeePaise: 2000,
          priorityFeePaise: 10000,
          priorityCancelRefundPct: 50,
        },
      ],
      {
        now: NOW,
        weeks: 6,
        seed: "money",
        businessSharePct: 70,
        paymentIdPrefix: `${biz.id.slice(0, 8)}-pay-`,
        customerUserId: "c",
      },
    );
    await insertRows(
      "payments",
      [
        "id",
        "user_id",
        "queue_id",
        "business_id",
        "kind",
        "amount_paise",
        "business_share_pct",
        "razorpay_order_id",
        "razorpay_payment_id",
        "status",
        "refund_paise",
        "expires_at",
        "created_at",
        "updated_at",
      ],
      h.payments.map((p) => [
        p.id,
        p.userId,
        p.queueId,
        p.businessId,
        p.kind,
        p.amountPaise,
        p.businessSharePct,
        p.razorpayOrderId,
        p.razorpayPaymentId,
        p.status,
        p.refundPaise,
        p.expiresAt,
        p.createdAt,
        p.updatedAt,
      ]),
    );
    await insertRows(
      "ledger_entries",
      [
        "id",
        "payment_id",
        "business_id",
        "kind",
        "amount_paise",
        "at",
        "created_at",
      ],
      h.ledger.map((l) => [
        l.id,
        l.paymentId,
        l.businessId,
        l.kind,
        l.amountPaise,
        l.at,
        l.at,
      ]),
    );

    for (const range of [7, 28] as const) {
      // How many events fall in the last 7 days depends on the time of day the
      // test runs, so the 7-day case pages by 1 to always cover paging (INC-074).
      const limit = range === 7 ? 1 : 25;
      const first = await expectOk(
        await earnings(biz.id, owner, `?range=${range}&limit=${limit}`),
        200,
        EarningsResponse,
      );
      expect(first.hasData).toBe(true);
      expect(first.days).toHaveLength(range);

      // Totals straight from the ledger.
      const sql = await env.DB.prepare(
        `SELECT
           SUM(CASE WHEN kind = 'capture' THEN amount_paise ELSE 0 END) AS cap,
           SUM(CASE WHEN kind = 'refund' THEN -amount_paise ELSE 0 END) AS ref,
           SUM(CASE WHEN kind = 'business_share' THEN amount_paise ELSE 0 END) AS b,
           SUM(CASE WHEN kind = 'platform_share' THEN amount_paise ELSE 0 END) AS pl,
           SUM(CASE WHEN kind = 'forfeit' THEN 1 ELSE 0 END) AS ff
         FROM ledger_entries WHERE business_id = ? AND at >= ? AND at <= ?`,
      )
        .bind(biz.id, first.from, first.to)
        .first<{
          cap: number;
          ref: number;
          b: number;
          pl: number;
          ff: number;
        }>();
      expect(first.totals).toMatchObject({
        capturedPaise: sql?.cap,
        refundedPaise: sql?.ref,
        businessSharePaise: sql?.b,
        platformSharePaise: sql?.pl,
        forfeits: sql?.ff,
      });
      expect(first.totals.capturedPaise).toBeGreaterThan(0);
      expect(first.totals.refunds).toBeGreaterThan(0);
      expect(first.totals.netPaise).toBe(
        first.totals.businessSharePaise + first.totals.platformSharePaise,
      );

      // Every page of the list adds up to the totals.
      const items: EarningsEvent[] = [...first.items];
      let cursor = first.nextCursor;
      let pages = 1;
      while (cursor) {
        const page = await expectOk(
          await earnings(
            biz.id,
            owner,
            `?range=${range}&limit=${limit}&cursor=${cursor}`,
          ),
          200,
          EarningsResponse,
        );
        expect(page.totals).toEqual(first.totals);
        items.push(...page.items);
        cursor = page.nextCursor;
        pages++;
      }
      expect(pages).toBeGreaterThan(1);
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
      const sum = (f: (e: EarningsEvent) => number) =>
        items.reduce((s, e) => s + f(e), 0);
      expect(sum((e) => e.amountPaise)).toBe(first.totals.netPaise);
      expect(sum((e) => e.businessSharePaise)).toBe(
        first.totals.businessSharePaise,
      );
      expect(sum((e) => e.platformSharePaise)).toBe(
        first.totals.platformSharePaise,
      );
      expect(items.filter((e) => e.kind === "capture")).toHaveLength(
        first.totals.captures,
      );
      expect(items.filter((e) => e.kind === "refund")).toHaveLength(
        first.totals.refunds,
      );
      expect(items.filter((e) => e.kind === "forfeit")).toHaveLength(
        first.totals.forfeits,
      );
      expect(
        sum((e) => (e.kind === "forfeit" ? e.paymentAmountPaise : 0)),
      ).toBe(first.totals.forfeitedPaise);
      // newest first
      for (let i = 1; i < items.length; i++) {
        expect((items[i - 1] as EarningsEvent).at).toBeGreaterThanOrEqual(
          (items[i] as EarningsEvent).at,
        );
      }
      // days add up to totals
      expect(first.days.reduce((s, d) => s + d.capturedPaise, 0)).toBe(
        first.totals.capturedPaise,
      );
      expect(items[0]?.queueName).toBe("OPD");
    }
  });

  it("INS-08: no ledger rows → hasData false, zero totals, empty list", async () => {
    const { biz } = await createBusiness("Quiet Clinic");
    const r = await expectOk(
      await earnings(biz.id, owner),
      200,
      EarningsResponse,
    );
    expect(r).toMatchObject({
      hasData: false,
      firstDataAt: null,
      items: [],
      nextCursor: null,
      businessSharePct: 70,
    });
    expect(r.totals.netPaise).toBe(0);
    expect(r.days).toHaveLength(7);
  });

  it("a payment captured before the range and refunded in it counts only the refund", async () => {
    const { biz, queues } = await createBusiness("Edge Clinic");
    const queueId = queues[0]?.id ?? "";
    const pid = `${biz.id.slice(0, 8)}-edge`;
    const capAt = NOW - 10 * DAY;
    const refAt = NOW - 2 * DAY;
    await insertRows(
      "payments",
      [
        "id",
        "user_id",
        "queue_id",
        "business_id",
        "kind",
        "amount_paise",
        "business_share_pct",
        "razorpay_order_id",
        "status",
        "refund_paise",
        "expires_at",
        "created_at",
        "updated_at",
      ],
      [
        [
          pid,
          "u",
          queueId,
          biz.id,
          "reservation",
          2000,
          70,
          `o-${pid}`,
          "refunded",
          2000,
          capAt,
          capAt,
          refAt,
        ],
      ],
    );
    await insertRows(
      "ledger_entries",
      [
        "id",
        "payment_id",
        "business_id",
        "kind",
        "amount_paise",
        "at",
        "created_at",
      ],
      [
        [`capture:${pid}`, pid, biz.id, "capture", 2000, capAt, capAt],
        [
          `capture_business:${pid}`,
          pid,
          biz.id,
          "business_share",
          1400,
          capAt,
          capAt,
        ],
        [
          `capture_platform:${pid}`,
          pid,
          biz.id,
          "platform_share",
          600,
          capAt,
          capAt,
        ],
        [`refund:${pid}`, pid, biz.id, "refund", -2000, refAt, refAt],
        [
          `refund_business:${pid}`,
          pid,
          biz.id,
          "business_share",
          -1400,
          refAt,
          refAt,
        ],
        [
          `refund_platform:${pid}`,
          pid,
          biz.id,
          "platform_share",
          -600,
          refAt,
          refAt,
        ],
      ],
    );
    const r = await expectOk(
      await earnings(biz.id, owner),
      200,
      EarningsResponse,
    );
    expect(r.totals).toMatchObject({
      capturedPaise: 0,
      refundedPaise: 2000,
      businessSharePaise: -1400,
      platformSharePaise: -600,
      netPaise: -2000,
      refunds: 1,
    });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      id: `refund:${pid}`,
      kind: "refund",
      amountPaise: -2000,
      paymentStatus: "refunded",
      paymentKind: "reservation",
    });
    const month = await expectOk(
      await earnings(biz.id, owner, "?range=28"),
      200,
      EarningsResponse,
    );
    expect(month.totals.netPaise).toBe(0);
    expect(month.items.map((i) => i.kind)).toEqual(["refund", "capture"]);
  });
});
