import { describe, expect, it } from "vitest";
import { type MapBusiness, MapQuery, type MapQueue } from "./map";
import {
  boxFromCorners,
  clampMapBox,
  mapQueryString,
  markerFeatures,
  markerLabel,
  markerStatus,
  shortWait,
  sortBusinesses,
  statsSummary,
} from "./map-view";

const MIN = 60_000;

function queue(over: Partial<MapQueue> = {}): MapQueue {
  return {
    id: "q1",
    name: "OPD",
    isOpen: true,
    isPaused: false,
    waiting: 3,
    waitLowMs: 10 * MIN,
    waitHighMs: 20 * MIN,
    updatedAt: 1,
    ...over,
  };
}

function biz(over: Partial<MapBusiness> & { id: string }): MapBusiness {
  const queues = over.queues ?? [queue()];
  return {
    name: over.id,
    category: "clinic",
    address: "Jammu",
    location: { lat: 32.7266, lng: 74.857 },
    isOpenNow: true,
    queues,
    summary: {
      waiting: queues.reduce((n, q) => n + q.waiting, 0),
      waitLowMs: 10 * MIN,
      waitHighMs: 20 * MIN,
      anyOpen: queues.some((q) => q.isOpen),
    },
    ...over,
  };
}

describe("boxFromCorners / clampMapBox (MAP-03)", () => {
  it("orders corners given as [lng, lat]", () => {
    expect(boxFromCorners([74.9, 32.8], [74.8, 32.7])).toEqual({
      minLat: 32.7,
      minLng: 74.8,
      maxLat: 32.8,
      maxLng: 74.9,
    });
  });

  it("snaps a small box outwards and leaves it unclamped", () => {
    const { box, clamped } = clampMapBox({
      minLat: 32.70049,
      minLng: 74.80051,
      maxLat: 32.75012,
      maxLng: 74.90001,
    });
    expect(clamped).toBe(false);
    expect(box).toEqual({
      minLat: 32.7,
      minLng: 74.8,
      maxLat: 32.751,
      maxLng: 74.901,
    });
  });

  it("small pans inside the grid give the same box", () => {
    const a = clampMapBox({
      minLat: 32.7001,
      minLng: 74.8001,
      maxLat: 32.7501,
      maxLng: 74.8501,
    });
    const b = clampMapBox({
      minLat: 32.7004,
      minLng: 74.8004,
      maxLat: 32.7504,
      maxLng: 74.8504,
    });
    expect(a.box).toEqual(b.box);
  });

  it("clamps a zoomed-out view around its centre so the API accepts it", () => {
    const { box, clamped } = clampMapBox({
      minLat: 30,
      minLng: 72,
      maxLat: 35,
      maxLng: 78,
    });
    expect(clamped).toBe(true);
    expect(box.maxLat - box.minLat).toBeLessThanOrEqual(1.5);
    expect(box.maxLng - box.minLng).toBeLessThanOrEqual(1.5);
    expect((box.minLat + box.maxLat) / 2).toBeCloseTo(32.5, 2);
    expect((box.minLng + box.maxLng) / 2).toBeCloseTo(75, 2);
    const q = MapQuery.safeParse(
      Object.fromEntries(
        mapQueryString(box)
          .split("&")
          .map((p) => p.split("=")),
      ),
    );
    expect(q.success).toBe(true);
  });

  it("keeps the box inside the world", () => {
    const { box } = clampMapBox({
      minLat: 89.9995,
      minLng: 179.9995,
      maxLat: 90,
      maxLng: 180,
    });
    expect(box.maxLat).toBe(90);
    expect(box.maxLng).toBe(180);
  });
});

describe("mapQueryString", () => {
  const box = { minLat: 32.7, minLng: 74.8, maxLat: 32.8, maxLng: 74.9 };
  it("adds filters only when set", () => {
    expect(mapQueryString(box)).toBe(
      "minLat=32.7&minLng=74.8&maxLat=32.8&maxLng=74.9",
    );
    expect(mapQueryString(box, { category: "lab", openNow: true })).toBe(
      "minLat=32.7&minLng=74.8&maxLat=32.8&maxLng=74.9&category=lab&openNow=1",
    );
    expect(mapQueryString(box, { category: null, openNow: false })).toBe(
      "minLat=32.7&minLng=74.8&maxLat=32.8&maxLng=74.9",
    );
  });
});

describe("marker status and label (MAP-02)", () => {
  it("open with a known wait", () => {
    const b = biz({ id: "a", queues: [queue({ waiting: 12 })] });
    b.summary = {
      waiting: 12,
      waitLowMs: 20 * MIN,
      waitHighMs: 30 * MIN,
      anyOpen: true,
    };
    expect(markerStatus(b)).toBe("open");
    expect(markerLabel(b)).toBe("12 · ~25 min");
  });

  it("open with an unknown wait", () => {
    const b = biz({ id: "a" });
    b.summary = {
      waiting: 0,
      waitLowMs: null,
      waitHighMs: null,
      anyOpen: true,
    };
    expect(markerLabel(b)).toBe("0 waiting");
  });

  it("paused when every open queue is paused", () => {
    const b = biz({
      id: "a",
      queues: [queue({ isPaused: true }), queue({ id: "q2", isOpen: false })],
    });
    b.summary = {
      waiting: 3,
      waitLowMs: null,
      waitHighMs: null,
      anyOpen: true,
    };
    expect(markerStatus(b)).toBe("paused");
    expect(markerLabel(b)).toBe("Paused");
  });

  it("open when one open queue is not paused", () => {
    const b = biz({
      id: "a",
      queues: [queue({ isPaused: true }), queue({ id: "q2" })],
    });
    expect(markerStatus(b)).toBe("open");
  });

  it("closed when no queue is open", () => {
    const b = biz({ id: "a", queues: [queue({ isOpen: false })] });
    b.summary = {
      waiting: 0,
      waitLowMs: null,
      waitHighMs: null,
      anyOpen: false,
    };
    expect(markerStatus(b)).toBe("closed");
    expect(markerLabel(b)).toBe("Closed");
  });

  it("short waits", () => {
    expect(shortWait(null, 5 * MIN)).toBeNull();
    expect(shortWait(0, 20_000)).toBe("< 1 min");
    expect(shortWait(60 * MIN, 80 * MIN)).toBe("~1 h 10 min");
    expect(shortWait(120 * MIN, 120 * MIN)).toBe("~2 h");
  });
});

describe("markerFeatures", () => {
  it("builds [lng, lat] point features with id, label and status", () => {
    const fc = markerFeatures([
      biz({ id: "a", location: { lat: 32.1, lng: 74.2 } }),
    ]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toEqual([
      {
        type: "Feature",
        id: "a",
        geometry: { type: "Point", coordinates: [74.2, 32.1] },
        properties: { id: "a", label: "3 · ~15 min", status: "open" },
      },
    ]);
  });
});

describe("sortBusinesses (MAP-04)", () => {
  const origin = { lat: 32.7266, lng: 74.857 };
  const near = biz({ id: "Near", location: { lat: 32.7276, lng: 74.857 } });
  const far = biz({ id: "Far", location: { lat: 32.8266, lng: 74.857 } });
  const closed = biz({
    id: "Closed",
    location: { lat: 32.7266, lng: 74.858 },
    queues: [queue({ isOpen: false })],
  });
  closed.summary = {
    waiting: 0,
    waitLowMs: null,
    waitHighMs: null,
    anyOpen: false,
  };
  const quick = biz({ id: "Quick", location: { lat: 32.9, lng: 74.9 } });
  quick.summary = { ...quick.summary, waitLowMs: 1 * MIN, waitHighMs: 3 * MIN };
  const items = [far, closed, quick, near];

  it("by distance, with distances", () => {
    const rows = sortBusinesses(items, "distance", origin);
    expect(rows.map((r) => r.id)).toEqual(["Closed", "Near", "Far", "Quick"]);
    expect(rows[1].distanceM).toBeGreaterThan(100);
    expect(rows[1].distanceM).toBeLessThan(120);
  });

  it("by distance without a location falls back to name, distance null", () => {
    const rows = sortBusinesses(items, "distance", null);
    expect(rows.map((r) => r.id)).toEqual(["Closed", "Far", "Near", "Quick"]);
    expect(rows.every((r) => r.distanceM === null)).toBe(true);
  });

  it("by shortest wait: known waits first, closed last", () => {
    const rows = sortBusinesses(items, "wait", origin);
    expect(rows.map((r) => r.id)).toEqual(["Quick", "Far", "Near", "Closed"]);
  });

  it("by name", () => {
    expect(sortBusinesses(items, "name", origin).map((r) => r.id)).toEqual([
      "Closed",
      "Far",
      "Near",
      "Quick",
    ]);
  });

  it("does not change the input", () => {
    const copy = [...items];
    sortBusinesses(items, "name", null);
    expect(items).toEqual(copy);
  });
});

describe("statsSummary (MAP-05)", () => {
  it("lists every known average and the basis", () => {
    expect(
      statsSummary({
        windowDays: 28,
        servedCount: 240,
        avgWaitMs: 18 * MIN,
        avgServiceMs: 6 * MIN,
        etaAccuracyPct: 82,
      }),
    ).toEqual({
      parts: [
        "Avg wait ~18 min",
        "Avg service ~6 min",
        "82% of estimates on time",
      ],
      basis: "based on 240 visits in 28 days",
    });
  });

  it("skips averages without enough samples", () => {
    expect(
      statsSummary({
        windowDays: 28,
        servedCount: 1,
        avgWaitMs: null,
        avgServiceMs: null,
        etaAccuracyPct: null,
      }),
    ).toEqual({ parts: [], basis: "based on 1 visit in 28 days" });
  });
});
