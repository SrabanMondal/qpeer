import { env } from "cloudflare:workers";
import {
  BusinessView,
  type CreateBusinessInput,
  defaultQueueSettings,
  defaultWeeklyHours,
  MeResponse,
  MyBusinessesResponse,
  QueueInfoResponse,
  QueueView,
  ValidationIssue,
} from "@qpeer/shared";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { businesses, businessMembers, queues, users } from "../src/db/schema";
import { geohash } from "../src/lib/geo";
import { MAX_ACTIVE_QUEUES } from "../src/modules/business/service";
import { expectError, expectOk, makeTestApi } from "./helpers";

type Api = Awaited<ReturnType<typeof makeTestApi>>;

const JAMMU = { lat: 32.7266, lng: 74.857 };
const JAMMU_MOVED = { lat: 32.7301, lng: 74.8645 };

let api: Api;
let owner: string; // registered owner token
let other: string; // a second registered user
let anon: string; // anonymous user

beforeAll(async () => {
  api = await makeTestApi();
  owner = await api.token({ sub: "owner-1", name: "Owner One" });
  other = await api.token({ sub: "other-1", name: "Other One" });
  anon = await api.token({ sub: "anon-1", anonymous: true });
});

const baseBusiness: CreateBusinessInput = {
  name: "City Clinic",
  category: "clinic",
  address: "Gandhi Nagar, Jammu",
};

async function createBusiness(
  body: Partial<CreateBusinessInput> = {},
  tok = owner,
): Promise<BusinessView> {
  const res = await api.call("POST", "/v1/businesses", tok, {
    ...baseBusiness,
    ...body,
  });
  return expectOk(res, 201, BusinessView);
}

async function createQueue(
  businessId: string,
  body: Record<string, unknown> = { name: "OPD" },
  tok = owner,
): Promise<QueueView> {
  const res = await api.call(
    "POST",
    `/v1/businesses/${businessId}/queues`,
    tok,
    body,
  );
  return expectOk(res, 201, QueueView);
}

/** A business with a pin and one active queue, i.e. listed. */
async function createListedBusiness() {
  const biz = await createBusiness({ location: JAMMU });
  const queue = await createQueue(biz.id);
  return { biz, queue };
}

async function getBusiness(id: string, tok = owner) {
  return api.call("GET", `/v1/businesses/${id}`, tok);
}

function issuePaths(details: unknown): string[] {
  return ValidationIssue.array()
    .parse(details)
    .map((i) => i.path);
}

describe("Identity", () => {
  it("IDN-06: PATCH /me updates the display name and it survives later sign-ins", async () => {
    const tok = await api.token({ sub: "idn06-user", name: "Google Name" });
    const res = await api.call("PATCH", "/v1/me", tok, {
      displayName: "  Asha  ",
    });
    const me = await expectOk(res, 200, MeResponse);
    expect(me.user.displayName).toBe("Asha");

    // The token still carries the Google name; the chosen name must stay.
    const again = await expectOk(
      await api.call("GET", "/v1/me", tok),
      200,
      MeResponse,
    );
    expect(again.user.displayName).toBe("Asha");
  });

  it("IDN-06: invalid display name -> 400 invalid_input", async () => {
    const tok = await api.token({ sub: "idn06-bad" });
    for (const displayName of ["", "   ", "x".repeat(61)]) {
      const err = await expectError(
        await api.call("PATCH", "/v1/me", tok, { displayName }),
        400,
        "invalid_input",
      );
      expect(issuePaths(err.details)).toEqual(["displayName"]);
    }
  });

  it("timestamps are stored as epoch milliseconds from the injected clock", async () => {
    api.clock.t += 1234;
    const tok = await api.token({ sub: "ms-user" });
    await expectOk(await api.call("GET", "/v1/me", tok), 200, MeResponse);
    const row = await db(env.DB)
      .select()
      .from(users)
      .where(eq(users.firebaseUid, "ms-user"))
      .get();
    expect(row?.createdAt.getTime()).toBe(api.clock.t);
    const raw = await env.DB.prepare(
      "SELECT created_at FROM users WHERE firebase_uid = ?",
    )
      .bind("ms-user")
      .first<{ created_at: number }>();
    expect(raw?.created_at).toBe(api.clock.t);
  });
});

describe("Business profile", () => {
  it("IDN-10: anonymous user -> 403 registration_required on create business", async () => {
    await expectError(
      await api.call("POST", "/v1/businesses", anon, baseBusiness),
      403,
      "registration_required",
    );
    await expectError(
      await api.call("GET", "/v1/me/businesses", anon),
      403,
      "registration_required",
    );
    const me = await expectOk(
      await api.call("GET", "/v1/me", anon),
      200,
      MeResponse,
    );
    const owned = await db(env.DB)
      .select()
      .from(businesses)
      .where(eq(businesses.ownerUserId, me.user.id))
      .all();
    expect(owned).toEqual([]);
  });

  it("IDN-10: no token -> 401 unauthorized", async () => {
    await expectError(
      await api.call("POST", "/v1/businesses", null, baseBusiness),
      401,
      "unauthorized",
    );
  });

  it("BIZ-01: create a business; creator becomes owner; defaults applied", async () => {
    const biz = await createBusiness({ phone: "+91 98765 43210" });
    expect(biz).toMatchObject({
      name: "City Clinic",
      category: "clinic",
      address: "Gandhi Nagar, Jammu",
      phone: "+91 98765 43210",
      location: null,
      status: "active",
      listed: false,
      myRole: "owner",
      queues: [],
      createdAt: api.clock.t,
      updatedAt: api.clock.t,
    });
    expect(biz.hours).toEqual(defaultWeeklyHours());

    const member = await db(env.DB)
      .select()
      .from(businessMembers)
      .where(eq(businessMembers.businessId, biz.id))
      .all();
    expect(member).toHaveLength(1);
    expect(member[0].role).toBe("owner");
  });

  it("BIZ-01: name, category and phone are validated", async () => {
    const err = await expectError(
      await api.call("POST", "/v1/businesses", owner, {
        name: " a ",
        category: "bakery",
        phone: "call me",
      }),
      400,
      "invalid_input",
    );
    expect(issuePaths(err.details).sort()).toEqual(
      ["category", "name", "phone"].sort(),
    );
  });

  it("BIZ-01/02: edit every field and read it back", async () => {
    const biz = await createBusiness();
    api.clock.t += 60_000;
    const hours = {
      ...defaultWeeklyHours(),
      mon: [
        { from: "08:00", to: "12:00" },
        { from: "16:00", to: "20:00" },
      ],
      sun: [{ from: "10:00", to: "13:00" }],
    };
    const patch = {
      name: "City Diagnostics",
      category: "lab",
      address: "Residency Road, Jammu",
      phone: "0191 2345678",
      location: JAMMU,
      hours,
    };
    const updated = await expectOk(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, patch),
      200,
      BusinessView,
    );
    expect(updated).toMatchObject({ ...patch, updatedAt: api.clock.t });
    expect(updated.createdAt).toBe(biz.createdAt);

    const read = await expectOk(await getBusiness(biz.id), 200, BusinessView);
    expect(read).toMatchObject(patch);

    // phone can be cleared
    const cleared = await expectOk(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, {
        phone: null,
      }),
      200,
      BusinessView,
    );
    expect(cleared.phone).toBeNull();
    expect(cleared.name).toBe("City Diagnostics");
  });

  it("BIZ-02: empty or unknown-field patch -> 400", async () => {
    const biz = await createBusiness();
    await expectError(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, {}),
      400,
      "invalid_input",
    );
    const err = await expectError(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, {
        status: "inactive",
      }),
      400,
      "invalid_input",
    );
    expect(err.details).toBeDefined();
  });

  it("BIZ-03/04: no pin -> not listed and pin missing; set pin; move pin", async () => {
    const biz = await createBusiness();
    expect(biz.listed).toBe(false);
    expect(biz.missingForListing).toEqual(["pin", "queue"]);

    const pinned = await expectOk(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, {
        location: JAMMU,
      }),
      200,
      BusinessView,
    );
    expect(pinned.location).toEqual(JAMMU);
    expect(pinned.missingForListing).toEqual(["queue"]);

    const moved = await expectOk(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, {
        location: JAMMU_MOVED,
      }),
      200,
      BusinessView,
    );
    expect(moved.location).toEqual(JAMMU_MOVED);

    const row = await db(env.DB)
      .select()
      .from(businesses)
      .where(eq(businesses.id, biz.id))
      .get();
    expect(row?.lat).toBe(JAMMU_MOVED.lat);
    expect(row?.lng).toBe(JAMMU_MOVED.lng);
    expect(row?.geohash).toBe(geohash(JAMMU_MOVED));
    expect(row?.geohash).not.toBe(geohash(JAMMU));
  });

  it("BIZ-03: a pin given at creation is stored with its geohash", async () => {
    const biz = await createBusiness({ location: JAMMU });
    expect(biz.location).toEqual(JAMMU);
    expect(biz.missingForListing).toEqual(["queue"]);
    const row = await db(env.DB)
      .select()
      .from(businesses)
      .where(eq(businesses.id, biz.id))
      .get();
    expect(row?.geohash).toBe(geohash(JAMMU));
    expect(row?.geohash).toHaveLength(9);
  });

  it("BIZ-03: out-of-range coordinates -> 400 with field paths", async () => {
    const err = await expectError(
      await api.call("POST", "/v1/businesses", owner, {
        ...baseBusiness,
        location: { lat: 91, lng: -181 },
      }),
      400,
      "invalid_input",
    );
    expect(issuePaths(err.details).sort()).toEqual([
      "location.lat",
      "location.lng",
    ]);
  });

  it("BIZ-05/06: bad hours -> 400 invalid_input with field details", async () => {
    const biz = await createBusiness();
    const cases: [unknown, string[]][] = [
      [
        {
          ...defaultWeeklyHours(),
          mon: [{ from: "18:00", to: "09:00" }],
        },
        ["hours.mon.0.to"],
      ],
      [
        {
          ...defaultWeeklyHours(),
          tue: [
            { from: "09:00", to: "13:00" },
            { from: "12:00", to: "17:00" },
          ],
        },
        ["hours.tue.1.from"],
      ],
      [
        {
          ...defaultWeeklyHours(),
          wed: [
            { from: "14:00", to: "17:00" },
            { from: "09:00", to: "12:00" },
          ],
        },
        ["hours.wed.1.from"],
      ],
      [
        { ...defaultWeeklyHours(), thu: [{ from: "9am", to: "17:00" }] },
        ["hours.thu.0.from"],
      ],
      [
        (() => {
          const { fri: _fri, ...rest } = defaultWeeklyHours();
          return rest;
        })(),
        ["hours.fri"],
      ],
    ];
    for (const [hours, paths] of cases) {
      const err = await expectError(
        await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, { hours }),
        400,
        "invalid_input",
      );
      expect(issuePaths(err.details)).toEqual(paths);
    }
    // nothing was written
    const read = await expectOk(await getBusiness(biz.id), 200, BusinessView);
    expect(read.hours).toEqual(defaultWeeklyHours());
  });

  it("BIZ-05: valid hours (split day, closed days) round-trip", async () => {
    const hours = {
      mon: [
        { from: "08:00", to: "10:00" },
        { from: "10:00", to: "13:00" },
        { from: "17:00", to: "21:30" },
      ],
      tue: [],
      wed: [{ from: "00:00", to: "23:59" }],
      thu: [{ from: "09:00", to: "18:00" }],
      fri: [{ from: "09:00", to: "18:00" }],
      sat: [],
      sun: [],
    };
    const biz = await createBusiness({ hours });
    expect(biz.hours).toEqual(hours);
    const read = await expectOk(await getBusiness(biz.id), 200, BusinessView);
    expect(read.hours).toEqual(hours);
  });

  it("malformed JSON body -> 400 invalid_input", async () => {
    await expectError(
      await api.call("POST", "/v1/businesses", owner, "{not json"),
      400,
      "invalid_input",
    );
  });
});

describe("Listing and status", () => {
  it("BIZ-07: listed only with pin + active queue + active status", async () => {
    const biz = await createBusiness();
    // no pin, no queue
    await expectError(await getBusiness(biz.id, other), 404, "not_found");

    // queue but no pin
    const queue = await createQueue(biz.id);
    let view = await expectOk(await getBusiness(biz.id), 200, BusinessView);
    expect(view.listed).toBe(false);
    expect(view.missingForListing).toEqual(["pin"]);
    await expectError(await getBusiness(biz.id, other), 404, "not_found");

    // pin + queue -> listed, public view for others
    await expectOk(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, owner, {
        location: JAMMU,
      }),
      200,
      BusinessView,
    );
    view = await expectOk(await getBusiness(biz.id), 200, BusinessView);
    expect(view.listed).toBe(true);
    expect(view.missingForListing).toEqual([]);

    const pub = await expectOk(
      await getBusiness(biz.id, other),
      200,
      BusinessView,
    );
    expect(pub.listed).toBe(true);
    expect(pub.myRole).toBeNull();
    expect(pub.missingForListing).toBeUndefined();
    expect(pub.queues).toHaveLength(1);
    expect(pub.queues[0].settings).toBeUndefined();
    expect(pub.queues[0].settingsVersion).toBeUndefined();

    // anonymous users can see a listed business too
    await expectOk(await getBusiness(biz.id, anon), 200, BusinessView);

    // archiving the only queue unlists it; archived queues are hidden publicly
    await expectOk(
      await api.call("POST", `/v1/queues/${queue.id}/archive`, owner),
      200,
      QueueView,
    );
    view = await expectOk(await getBusiness(biz.id), 200, BusinessView);
    expect(view.listed).toBe(false);
    expect(view.missingForListing).toEqual(["queue"]);
    expect(view.queues.map((q) => q.status)).toEqual(["archived"]);
    await expectError(await getBusiness(biz.id, other), 404, "not_found");
  });

  it("BIZ-07: public view excludes archived queues", async () => {
    const { biz } = await createListedBusiness();
    api.clock.t += 1000; // queues are listed oldest first
    const second = await createQueue(biz.id, { name: "Lab" });
    await expectOk(
      await api.call("POST", `/v1/queues/${second.id}/archive`, owner),
      200,
      QueueView,
    );
    const pub = await expectOk(
      await getBusiness(biz.id, other),
      200,
      BusinessView,
    );
    expect(pub.queues.map((q) => q.name)).toEqual(["OPD"]);
    const mine = await expectOk(await getBusiness(biz.id), 200, BusinessView);
    expect(mine.queues.map((q) => q.name)).toEqual(["OPD", "Lab"]);
  });

  it("BIZ-08: deactivate -> not listed; activate -> listed again; idempotent", async () => {
    const { biz } = await createListedBusiness();

    api.clock.t += 1000;
    const off = await expectOk(
      await api.call("POST", `/v1/businesses/${biz.id}/deactivate`, owner),
      200,
      BusinessView,
    );
    expect(off.status).toBe("inactive");
    expect(off.listed).toBe(false);
    expect(off.updatedAt).toBe(api.clock.t);
    await expectError(await getBusiness(biz.id, other), 404, "not_found");

    // second deactivate: same result, updated_at unchanged
    const offAt = api.clock.t;
    api.clock.t += 1000;
    const off2 = await expectOk(
      await api.call("POST", `/v1/businesses/${biz.id}/deactivate`, owner),
      200,
      BusinessView,
    );
    expect(off2.status).toBe("inactive");
    expect(off2.updatedAt).toBe(offAt);

    // owner still sees it in their list
    const mine = await expectOk(
      await api.call("GET", "/v1/me/businesses", owner),
      200,
      MyBusinessesResponse,
    );
    expect(mine.items.find((b) => b.id === biz.id)?.status).toBe("inactive");

    const on = await expectOk(
      await api.call("POST", `/v1/businesses/${biz.id}/activate`, owner),
      200,
      BusinessView,
    );
    expect(on.status).toBe("active");
    expect(on.listed).toBe(true);
    const on2 = await expectOk(
      await api.call("POST", `/v1/businesses/${biz.id}/activate`, owner),
      200,
      BusinessView,
    );
    expect(on2.status).toBe("active");
    await expectOk(await getBusiness(biz.id, other), 200, BusinessView);
  });

  it("BIZ-09/BIZ-15: GET /me/businesses lists only my businesses with role and queues", async () => {
    const solo = await api.token({ sub: "multi-owner" });
    const empty = await expectOk(
      await api.call("GET", "/v1/me/businesses", solo),
      200,
      MyBusinessesResponse,
    );
    expect(empty.items).toEqual([]);

    const a = await createBusiness({ name: "Shop A" }, solo);
    api.clock.t += 1000; // listed oldest first
    const b = await createBusiness({ name: "Shop B" }, solo);
    await createQueue(b.id, { name: "Counter" }, solo);
    await createBusiness({ name: "Someone else's" }, other);

    const list = await expectOk(
      await api.call("GET", "/v1/me/businesses", solo),
      200,
      MyBusinessesResponse,
    );
    expect(list.items.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(list.items.every((x) => x.myRole === "owner")).toBe(true);
    expect(list.items[1].queues.map((q) => q.name)).toEqual(["Counter"]);
    expect(list.items[1].queues[0].settings).toEqual(defaultQueueSettings());
  });
});

describe("Queues", () => {
  it("BIZ-10/12: create a queue with default settings", async () => {
    const biz = await createBusiness();
    const q = await createQueue(biz.id, { name: "  Sample collection " });
    expect(q).toMatchObject({
      businessId: biz.id,
      name: "Sample collection",
      status: "active",
      settings: defaultQueueSettings(),
      settingsVersion: 1,
      joinUrl: `qpeer://q/${q.id}`,
      createdAt: api.clock.t,
    });
  });

  it("BIZ-12: create with a settings patch merges with defaults", async () => {
    const biz = await createBusiness();
    const q = await createQueue(biz.id, {
      name: "OPD",
      settings: { joinRadiusM: 400, counters: 3 },
    });
    expect(q.settings).toEqual({
      ...defaultQueueSettings(),
      joinRadiusM: 400,
      counters: 3,
    });
  });

  it("BIZ-12: out-of-bounds or unknown settings -> 400", async () => {
    const biz = await createBusiness();
    const err = await expectError(
      await api.call("POST", `/v1/businesses/${biz.id}/queues`, owner, {
        name: "OPD",
        settings: { joinRadiusM: 10, graceMinutes: 0, bogus: 1 },
      }),
      400,
      "invalid_input",
    );
    expect(issuePaths(err.details).sort()).toEqual(
      ["settings", "settings.graceMinutes", "settings.joinRadiusM"].sort(),
    );
    await expectError(
      await api.call("POST", `/v1/businesses/${biz.id}/queues`, owner, {
        name: "",
      }),
      400,
      "invalid_input",
    );
  });

  it("BIZ-11/12: settings patch merges and bumps settings_version; rename does not", async () => {
    const biz = await createBusiness();
    const q = await createQueue(biz.id);

    api.clock.t += 5000;
    const patched = await expectOk(
      await api.call("PATCH", `/v1/queues/${q.id}`, owner, {
        settings: { graceMinutes: 15 },
      }),
      200,
      QueueView,
    );
    expect(patched.settings).toEqual({
      ...defaultQueueSettings(),
      graceMinutes: 15,
    });
    expect(patched.settingsVersion).toBe(2);
    expect(patched.updatedAt).toBe(api.clock.t);

    const patched2 = await expectOk(
      await api.call("PATCH", `/v1/queues/${q.id}`, owner, {
        settings: { maxSize: 500 },
      }),
      200,
      QueueView,
    );
    expect(patched2.settings).toEqual({
      ...defaultQueueSettings(),
      graceMinutes: 15,
      maxSize: 500,
    });
    expect(patched2.settingsVersion).toBe(3);

    // same values -> no version bump
    const same = await expectOk(
      await api.call("PATCH", `/v1/queues/${q.id}`, owner, {
        settings: { maxSize: 500 },
      }),
      200,
      QueueView,
    );
    expect(same.settingsVersion).toBe(3);

    const renamed = await expectOk(
      await api.call("PATCH", `/v1/queues/${q.id}`, owner, { name: "General" }),
      200,
      QueueView,
    );
    expect(renamed.name).toBe("General");
    expect(renamed.settingsVersion).toBe(3);

    const row = await db(env.DB)
      .select()
      .from(queues)
      .where(eq(queues.id, q.id))
      .get();
    expect(row?.settingsVersion).toBe(3);
    expect(row?.settingsJson.maxSize).toBe(500);

    await expectError(
      await api.call("PATCH", `/v1/queues/${q.id}`, owner, {}),
      400,
      "invalid_input",
    );
  });

  it("BIZ-11: archive (idempotent); archived queues can't be edited", async () => {
    const biz = await createBusiness();
    const q = await createQueue(biz.id);
    const archived = await expectOk(
      await api.call("POST", `/v1/queues/${q.id}/archive`, owner),
      200,
      QueueView,
    );
    expect(archived.status).toBe("archived");
    const again = await expectOk(
      await api.call("POST", `/v1/queues/${q.id}/archive`, owner),
      200,
      QueueView,
    );
    expect(again.status).toBe("archived");
    await expectError(
      await api.call("PATCH", `/v1/queues/${q.id}`, owner, { name: "X" }),
      409,
      "invalid_state",
    );
  });

  it(`BIZ-10: at most ${MAX_ACTIVE_QUEUES} active queues per business -> 409 conflict`, async () => {
    const biz = await createBusiness();
    const created: QueueView[] = [];
    for (let i = 0; i < MAX_ACTIVE_QUEUES; i++) {
      created.push(await createQueue(biz.id, { name: `Q${i}` }));
    }
    await expectError(
      await api.call("POST", `/v1/businesses/${biz.id}/queues`, owner, {
        name: "One too many",
      }),
      409,
      "conflict",
    );
    // archived queues don't count
    await expectOk(
      await api.call("POST", `/v1/queues/${created[0].id}/archive`, owner),
      200,
      QueueView,
    );
    await createQueue(biz.id, { name: "Replacement" });

    const active = await db(env.DB)
      .select()
      .from(queues)
      .where(and(eq(queues.businessId, biz.id), eq(queues.status, "active")))
      .all();
    expect(active).toHaveLength(MAX_ACTIVE_QUEUES);
  });

  it("BIZ-10: parallel creates never exceed the limit", async () => {
    const biz = await createBusiness();
    const results = await Promise.all(
      Array.from({ length: MAX_ACTIVE_QUEUES + 5 }, (_, i) =>
        api.call("POST", `/v1/businesses/${biz.id}/queues`, owner, {
          name: `P${i}`,
        }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(MAX_ACTIVE_QUEUES);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
  });

  it("JON-03: GET /queues/:id public info; 404 when not listed or archived", async () => {
    const { biz, queue } = await createListedBusiness();
    const info = await expectOk(
      await api.call("GET", `/v1/queues/${queue.id}`, other),
      200,
      QueueInfoResponse,
    );
    expect(info.queue.name).toBe("OPD");
    expect(info.queue.settings).toBeUndefined();
    expect(info.business).toMatchObject({
      id: biz.id,
      name: "City Clinic",
      location: JAMMU,
      status: "active",
      listed: true,
    });
    expect(info.myRole).toBeNull();

    const mine = await expectOk(
      await api.call("GET", `/v1/queues/${queue.id}`, owner),
      200,
      QueueInfoResponse,
    );
    expect(mine.myRole).toBe("owner");
    expect(mine.queue.settings).toEqual(defaultQueueSettings());

    // unlisted business (deactivated) -> 404 for others, 200 for owner
    await expectOk(
      await api.call("POST", `/v1/businesses/${biz.id}/deactivate`, owner),
      200,
      BusinessView,
    );
    await expectError(
      await api.call("GET", `/v1/queues/${queue.id}`, other),
      404,
      "not_found",
    );
    await expectOk(
      await api.call("GET", `/v1/queues/${queue.id}`, owner),
      200,
      QueueInfoResponse,
    );
    await expectOk(
      await api.call("POST", `/v1/businesses/${biz.id}/activate`, owner),
      200,
      BusinessView,
    );

    // an archived queue of a listed business -> 404 for others
    const extra = await createQueue(biz.id, { name: "Old" });
    await expectOk(
      await api.call("POST", `/v1/queues/${extra.id}/archive`, owner),
      200,
      QueueView,
    );
    await expectError(
      await api.call("GET", `/v1/queues/${extra.id}`, other),
      404,
      "not_found",
    );
    await expectError(
      await api.call("GET", `/v1/queues/${crypto.randomUUID()}`, other),
      404,
      "not_found",
    );
  });
});

describe("BIZ-16: only the owner can edit a business or its queues (IDOR)", () => {
  it("BIZ-16: another registered user gets 404 on every owner action, and nothing changes", async () => {
    // Listed business: existence is public, but edits must still be 404.
    const { biz, queue } = await createListedBusiness();
    // Unlisted business: the other user must not learn it exists at all.
    const hidden = await createBusiness({ name: "Hidden Lab" });
    const hiddenQueue = await createQueue(hidden.id, { name: "Hidden Q" });

    const before = await db(env.DB).select().from(businesses).all();
    const beforeQueues = await db(env.DB).select().from(queues).all();

    for (const target of [
      { b: biz.id, q: queue.id },
      { b: hidden.id, q: hiddenQueue.id },
    ]) {
      const attempts: [string, string, unknown][] = [
        ["PATCH", `/v1/businesses/${target.b}`, { name: "Hacked" }],
        ["PATCH", `/v1/businesses/${target.b}`, { location: JAMMU_MOVED }],
        ["POST", `/v1/businesses/${target.b}/deactivate`, undefined],
        ["POST", `/v1/businesses/${target.b}/activate`, undefined],
        ["POST", `/v1/businesses/${target.b}/queues`, { name: "Rogue" }],
        ["PATCH", `/v1/queues/${target.q}`, { name: "Hacked" }],
        ["PATCH", `/v1/queues/${target.q}`, { settings: { maxSize: 10 } }],
        ["POST", `/v1/queues/${target.q}/archive`, undefined],
      ];
      for (const [method, path, body] of attempts) {
        const err = await expectError(
          await api.call(method, path, other, body),
          404,
          "not_found",
        );
        // Same body as for an id that doesn't exist at all (no existence leak).
        expect(err.message).toBe("Not found");
      }
    }

    // The unlisted business and its queue are invisible to the other user.
    await expectError(await getBusiness(hidden.id, other), 404, "not_found");
    await expectError(
      await api.call("GET", `/v1/queues/${hiddenQueue.id}`, other),
      404,
      "not_found",
    );
    const theirs = await expectOk(
      await api.call("GET", "/v1/me/businesses", other),
      200,
      MyBusinessesResponse,
    );
    expect(theirs.items.map((b) => b.id)).not.toContain(hidden.id);
    expect(theirs.items.map((b) => b.id)).not.toContain(biz.id);

    // Nothing was written.
    expect(await db(env.DB).select().from(businesses).all()).toEqual(before);
    expect(await db(env.DB).select().from(queues).all()).toEqual(beforeQueues);
    const otherMembership = await db(env.DB)
      .select()
      .from(businessMembers)
      .where(eq(businessMembers.businessId, hidden.id))
      .all();
    expect(otherMembership.map((m) => m.role)).toEqual(["owner"]);
  });

  it("BIZ-16: non-existent ids give the same 404 as someone else's", async () => {
    const ghost = crypto.randomUUID();
    for (const [method, path, body] of [
      ["PATCH", `/v1/businesses/${ghost}`, { name: "Ghost" }],
      ["POST", `/v1/businesses/${ghost}/deactivate`, undefined],
      ["POST", `/v1/businesses/${ghost}/queues`, { name: "Ghost" }],
      ["PATCH", `/v1/queues/${ghost}`, { name: "Ghost" }],
      ["POST", `/v1/queues/${ghost}/archive`, undefined],
      ["GET", `/v1/businesses/${ghost}`, undefined],
    ] as const) {
      const err = await expectError(
        await api.call(method, path, owner, body),
        404,
        "not_found",
      );
      expect(err.message).toBe("Not found");
    }
  });

  it("BIZ-16: staff member gets 403 forbidden on owner actions but sees the full view", async () => {
    const { biz, queue } = await createListedBusiness();
    const staffTok = await api.token({ sub: "staff-1" });
    const me = await expectOk(
      await api.call("GET", "/v1/me", staffTok),
      200,
      MeResponse,
    );
    await db(env.DB)
      .insert(businessMembers)
      .values({
        businessId: biz.id,
        userId: me.user.id,
        role: "staff",
        createdAt: new Date(api.clock.t),
        updatedAt: new Date(api.clock.t),
      });

    for (const [method, path, body] of [
      ["PATCH", `/v1/businesses/${biz.id}`, { name: "Staff edit" }],
      ["POST", `/v1/businesses/${biz.id}/deactivate`, undefined],
      ["POST", `/v1/businesses/${biz.id}/queues`, { name: "Staff Q" }],
      ["PATCH", `/v1/queues/${queue.id}`, { name: "Staff edit" }],
      ["POST", `/v1/queues/${queue.id}/archive`, undefined],
    ] as const) {
      await expectError(
        await api.call(method, path, staffTok, body),
        403,
        "forbidden",
      );
    }

    const view = await expectOk(
      await getBusiness(biz.id, staffTok),
      200,
      BusinessView,
    );
    expect(view.myRole).toBe("staff");
    expect(view.missingForListing).toBeUndefined();
    expect(view.queues[0].settings).toEqual(defaultQueueSettings());
    expect(view.name).toBe("City Clinic");
  });

  it("BIZ-16/IDN-10: an anonymous user can't act as owner either", async () => {
    const { biz, queue } = await createListedBusiness();
    await expectError(
      await api.call("PATCH", `/v1/businesses/${biz.id}`, anon, { name: "X" }),
      403,
      "registration_required",
    );
    await expectError(
      await api.call("POST", `/v1/queues/${queue.id}/archive`, anon),
      403,
      "registration_required",
    );
  });
});

describe("Error contract", () => {
  it("unknown route -> 404 not_found in the error shape", async () => {
    await expectError(
      await api.call("GET", "/v1/nope", owner),
      404,
      "not_found",
    );
    await expectError(await api.call("GET", "/nope", null), 404, "not_found");
  });
});
