import {
  type BusinessCategory,
  defaultWeeklyHours,
  QueueSettings,
  type WeeklyHours,
} from "@qpeer/shared";
import { eq, inArray, like } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  analyticsHourly,
  businesses,
  businessMembers,
  queueSnapshots,
  queues,
  tokens,
} from "../../db/schema";
import type { Bindings } from "../../env";
import { geohash } from "../../lib/geo";
import { DAY_MS } from "../../lib/time";
import { initQueueDO } from "../business/service";
import { queueStub, unwrap } from "../queue/do-client";

/**
 * Dev map seed (Step 3): ~8 listed demo businesses around Jammu so the map can
 * be tried before the Step 5 demo seed. Ids are deterministic UUID-shaped
 * strings with a fixed prefix, which is how unseed finds exactly them.
 */
export const SEED_BUSINESS_PREFIX = "5eed0000-";
export const SEED_QUEUE_PREFIX = "5eed0001-";
/** Owner of every seeded business (not the caller, and no real Firebase uid). */
export const SEED_OWNER_ID = "seed-map-owner";
export const SEED_NAME_PREFIX = "Demo · ";

const businessId = (i: number) =>
  `${SEED_BUSINESS_PREFIX}0000-4000-8000-${String(i).padStart(12, "0")}`;
const queueId = (i: number, j: number) =>
  `${SEED_QUEUE_PREFIX}0000-4000-8000-${String(i * 10 + j).padStart(12, "0")}`;

const allDays = (from: string, to: string): WeeklyHours => {
  const d = () => [{ from, to }];
  return {
    mon: d(),
    tue: d(),
    wed: d(),
    thu: d(),
    fri: d(),
    sat: d(),
    sun: d(),
  };
};

const splitShift = (): WeeklyHours => {
  const d = () => [
    { from: "09:00", to: "13:00" },
    { from: "17:00", to: "20:30" },
  ];
  return {
    mon: d(),
    tue: d(),
    wed: d(),
    thu: d(),
    fri: d(),
    sat: d(),
    sun: [],
  };
};

interface SeedBusiness {
  name: string;
  category: BusinessCategory;
  area: string;
  lat: number;
  lng: number;
  hours: WeeklyHours;
  /** Queue name → people waiting to put in (as triage tokens). */
  queues: [string, number][];
}

/** Approximate locations, all within ~6 km of 32.7266, 74.8570. */
const SEED: SeedBusiness[] = [
  {
    name: "Gandhi Nagar Family Clinic",
    category: "clinic",
    area: "Gandhi Nagar",
    lat: 32.709,
    lng: 74.858,
    hours: splitShift(),
    queues: [
      ["OPD", 3],
      ["Pharmacy", 1],
    ],
  },
  {
    name: "Trikuta Diagnostics",
    category: "lab",
    area: "Trikuta Nagar",
    lat: 32.6945,
    lng: 74.87,
    hours: allDays("07:00", "21:00"),
    queues: [
      ["Sample collection", 4],
      ["Reports", 0],
    ],
  },
  {
    name: "Bakshi Nagar Mobile Care",
    category: "service_centre",
    area: "Bakshi Nagar",
    lat: 32.738,
    lng: 74.872,
    hours: defaultWeeklyHours(),
    queues: [["Repairs", 2]],
  },
  {
    name: "Rehari Style Studio",
    category: "salon",
    area: "Rehari",
    lat: 32.7395,
    lng: 74.856,
    hours: allDays("10:00", "20:00"),
    queues: [["Walk-ins", 2]],
  },
  {
    name: "Talab Tillo Health Centre",
    category: "clinic",
    area: "Talab Tillo",
    lat: 32.748,
    lng: 74.845,
    hours: allDays("08:00", "20:00"),
    queues: [
      ["General OPD", 4],
      ["Dental", 1],
    ],
  },
  {
    name: "Janipur Path Lab",
    category: "lab",
    area: "Janipur",
    lat: 32.752,
    lng: 74.837,
    hours: defaultWeeklyHours(),
    queues: [["Blood tests", 0]],
  },
  {
    name: "Channi Himmat Service Point",
    category: "other",
    area: "Channi Himmat",
    lat: 32.687,
    lng: 74.88,
    hours: allDays("09:30", "17:30"),
    queues: [["Counter", 3]],
  },
  {
    name: "Old City Barbers",
    category: "salon",
    area: "Raghunath Bazar, Old City",
    lat: 32.73,
    lng: 74.865,
    hours: allDays("08:00", "22:00"),
    queues: [["Haircut", 2]],
  },
];

export interface SeedResult {
  businesses: number;
  queues: number;
  /** Businesses inserted by this call (0 when everything already existed). */
  created: number;
}

/**
 * Idempotent: rows are inserted with ON CONFLICT DO NOTHING on fixed ids, queue
 * DOs are initialised and opened (both idempotent), and triage tokens only top a
 * queue up to its target waiting count.
 */
export async function seedMap({
  db,
  env,
  now,
}: {
  db: Db;
  env: Pick<Bindings, "QUEUE">;
  now: number;
}): Promise<SeedResult> {
  const at = new Date(now);
  // Listed "30 days ago" with the opt-in on, so public stats are never hidden.
  const listedAt = new Date(now - 30 * DAY_MS);
  let created = 0;
  let queueCount = 0;

  for (const [i, s] of SEED.entries()) {
    const id = businessId(i + 1);
    const inserted = await db
      .insert(businesses)
      .values({
        id,
        ownerUserId: SEED_OWNER_ID,
        name: `${SEED_NAME_PREFIX}${s.name}`,
        category: s.category,
        address: `${s.area}, Jammu`,
        phone: null,
        lat: s.lat,
        lng: s.lng,
        geohash: geohash({ lat: s.lat, lng: s.lng }),
        hoursJson: s.hours,
        status: "active",
        publicStats: true,
        firstListedAt: listedAt,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing()
      .returning({ id: businesses.id });
    created += inserted.length;

    await db
      .insert(businessMembers)
      .values({
        businessId: id,
        userId: SEED_OWNER_ID,
        role: "owner",
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing();

    for (const [j, [name, target]] of s.queues.entries()) {
      const qid = queueId(i + 1, j + 1);
      await db
        .insert(queues)
        .values({
          id: qid,
          businessId: id,
          name,
          status: "active",
          settingsJson: QueueSettings.parse({}),
          settingsVersion: 1,
          createdAt: at,
          updatedAt: at,
        })
        .onConflictDoNothing();
      const q = await db.select().from(queues).where(eq(queues.id, qid)).get();
      if (q?.status !== "active") continue;
      queueCount++;

      await initQueueDO(db, env, q);
      const stub = queueStub(env, qid);
      unwrap(await stub.open());
      const { waiting } = await stub.getSummary();
      for (let n = waiting; n < target; n++) {
        const r = await stub.insertTriage();
        if (!r.ok) break; // daily triage cap reached: keep what we have
      }
    }
  }
  return { businesses: SEED.length, queues: queueCount, created };
}

/** Deletes exactly the seeded businesses (by id prefix) and their rows; closes their queues. */
export async function unseedMap({
  db,
  env,
}: {
  db: Db;
  env: Pick<Bindings, "QUEUE">;
}): Promise<{ businesses: number }> {
  const bizRows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(like(businesses.id, `${SEED_BUSINESS_PREFIX}%`))
    .all();
  const ids = bizRows.map((r) => r.id);
  if (ids.length === 0) return { businesses: 0 };

  const qRows = await db
    .select({ id: queues.id })
    .from(queues)
    .where(inArray(queues.businessId, ids))
    .all();
  // Close first: the DO flushes its last snapshot/analytics now, and later
  // snapshot writes insert nothing once the business row is gone.
  for (const q of qRows) unwrap(await queueStub(env, q.id).close());

  await db.batch([
    db.delete(queueSnapshots).where(inArray(queueSnapshots.businessId, ids)),
    db.delete(analyticsHourly).where(inArray(analyticsHourly.businessId, ids)),
    db.delete(tokens).where(inArray(tokens.businessId, ids)),
    db.delete(queues).where(inArray(queues.businessId, ids)),
    db.delete(businessMembers).where(inArray(businessMembers.businessId, ids)),
    db.delete(businesses).where(inArray(businesses.id, ids)),
  ]);
  return { businesses: ids.length };
}
