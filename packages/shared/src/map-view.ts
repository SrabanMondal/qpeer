import type { BusinessCategory, BusinessStats } from "./business";
import { distanceMeters, type LatLng } from "./geo";
import { MAP_MAX_BOX_DEG, type MapBusiness } from "./map";

/**
 * Pure helpers for the app's map and list (MAP-01…05). No React Native
 * imports, so they are unit-tested here with Vitest.
 */

const MINUTE_MS = 60_000;

/** A lat/lng bounding box, as `GET /v1/map` takes it. */
export type MapBox = {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
};

/** Grid the box edges snap outwards to (≈ 110 m), so small pans reuse the same query key. */
const SNAP_DEG = 0.001;

const floorTo = (v: number) => Math.floor(v / SNAP_DEG) * SNAP_DEG;
const ceilTo = (v: number) => Math.ceil(v / SNAP_DEG) * SNAP_DEG;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Box from two opposite corners given as Mapbox positions `[lng, lat]` (e.g.
 * the camera's `ne` / `sw`), in any order.
 */
export function boxFromCorners(
  a: readonly number[],
  b: readonly number[],
): MapBox {
  return {
    minLat: Math.min(a[1], b[1]),
    minLng: Math.min(a[0], b[0]),
    maxLat: Math.max(a[1], b[1]),
    maxLng: Math.max(a[0], b[0]),
  };
}

/**
 * The box to ask the API for: edges snapped outwards to a ~110 m grid and
 * kept inside the world; each side at most `MAP_MAX_BOX_DEG` around the
 * visible centre. `clamped` = the visible area was larger (show "Zoom in").
 */
export function clampMapBox(
  box: MapBox,
  maxDeg: number = MAP_MAX_BOX_DEG,
): { box: MapBox; clamped: boolean } {
  let { minLat, minLng, maxLat, maxLng } = box;
  let clamped = false;
  // Room for the outward snap plus float error, so the server's ≤ check passes.
  const half = maxDeg / 2 - 2 * SNAP_DEG;
  if (maxLat - minLat > maxDeg) {
    const c = (minLat + maxLat) / 2;
    minLat = c - half;
    maxLat = c + half;
    clamped = true;
  }
  if (maxLng - minLng > maxDeg) {
    const c = (minLng + maxLng) / 2;
    minLng = c - half;
    maxLng = c + half;
    clamped = true;
  }
  return {
    box: {
      minLat: round6(clamp(floorTo(minLat), -90, 90)),
      minLng: round6(clamp(floorTo(minLng), -180, 180)),
      maxLat: round6(clamp(ceilTo(maxLat), -90, 90)),
      maxLng: round6(clamp(ceilTo(maxLng), -180, 180)),
    },
    clamped,
  };
}

/** Query string for `GET /v1/map` (no leading `?`). */
export function mapQueryString(
  box: MapBox,
  filters: { category?: BusinessCategory | null; openNow?: boolean } = {},
): string {
  const parts = [
    `minLat=${box.minLat}`,
    `minLng=${box.minLng}`,
    `maxLat=${box.maxLat}`,
    `maxLng=${box.maxLng}`,
  ];
  if (filters.category) parts.push(`category=${filters.category}`);
  if (filters.openNow) parts.push("openNow=1");
  return parts.join("&");
}

// ---------- marker look ----------

/** `open`: someone can join now; `paused`: open but every open queue is paused; `closed`: no open queue. */
export type MarkerStatus = "open" | "paused" | "closed";

export function markerStatus(
  b: Pick<MapBusiness, "queues" | "summary">,
): MarkerStatus {
  if (!b.summary.anyOpen) return "closed";
  const open = b.queues.filter((q) => q.isOpen);
  if (open.length > 0 && open.every((q) => q.isPaused)) return "paused";
  return "open";
}

/** A short wait for pills and rows: "~25 min", "~1 h 10 min", "< 1 min"; null when unknown. */
export function shortWait(
  lowMs: number | null,
  highMs: number | null,
): string | null {
  if (lowMs === null || highMs === null) return null;
  const mid = Math.round(
    (Math.max(0, lowMs) + Math.max(0, highMs)) / 2 / MINUTE_MS,
  );
  if (mid <= 0) return "< 1 min";
  if (mid < 60) return `~${mid} min`;
  const h = Math.floor(mid / 60);
  const m = mid % 60;
  return m === 0 ? `~${h} h` : `~${h} h ${m} min`;
}

/**
 * Marker pill text (design guide `MapPill`): "12 · ~25 min" when open with a
 * known wait, "12 waiting" while the wait is still unknown, "Paused", "Closed".
 */
export function markerLabel(
  b: Pick<MapBusiness, "queues" | "summary">,
): string {
  const status = markerStatus(b);
  if (status === "closed") return "Closed";
  if (status === "paused") return "Paused";
  const wait = shortWait(b.summary.waitLowMs, b.summary.waitHighMs);
  return wait
    ? `${b.summary.waiting} · ${wait}`
    : `${b.summary.waiting} waiting`;
}

// ---------- GeoJSON ----------

export type MarkerProperties = {
  id: string;
  label: string;
  status: MarkerStatus;
};

export type MarkerFeature = {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: MarkerProperties;
};

export type MarkerFeatureCollection = {
  type: "FeatureCollection";
  features: MarkerFeature[];
};

/** One point feature per business, `[lng, lat]`, for a clustered Mapbox `ShapeSource`. */
export function markerFeatures(
  items: readonly MapBusiness[],
): MarkerFeatureCollection {
  return {
    type: "FeatureCollection",
    features: items.map((b) => ({
      type: "Feature",
      id: b.id,
      geometry: {
        type: "Point",
        coordinates: [b.location.lng, b.location.lat],
      },
      properties: { id: b.id, label: markerLabel(b), status: markerStatus(b) },
    })),
  };
}

// ---------- list ----------

export type MapSort = "distance" | "wait" | "name";

export type ListedBusiness = MapBusiness & {
  /** Metres from the user; null when the user's location is unknown. */
  distanceM: number | null;
};

const STATUS_RANK: Record<MarkerStatus, number> = {
  open: 0,
  paused: 1,
  closed: 2,
};

const byName = (a: MapBusiness, b: MapBusiness) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/**
 * List rows (MAP-04) with their distance, sorted by:
 * - `distance`: nearest first (falls back to name without a location);
 * - `wait`: open businesses with a known wait first, shortest first; then
 *   open without a known wait, paused, closed;
 * - `name`: A–Z.
 */
export function sortBusinesses(
  items: readonly MapBusiness[],
  sort: MapSort,
  origin: LatLng | null,
): ListedBusiness[] {
  const rows: ListedBusiness[] = items.map((b) => ({
    ...b,
    distanceM: origin ? distanceMeters(origin, b.location) : null,
  }));
  const waitKey = (b: ListedBusiness) => {
    const status = markerStatus(b);
    if (status === "open" && b.summary.waitLowMs !== null) {
      return [0, b.summary.waitLowMs] as const;
    }
    return [1 + STATUS_RANK[status], 0] as const;
  };
  rows.sort((a, b) => {
    if (sort === "distance" && a.distanceM !== null && b.distanceM !== null) {
      return a.distanceM - b.distanceM || byName(a, b);
    }
    if (sort === "wait") {
      const ka = waitKey(a);
      const kb = waitKey(b);
      return ka[0] - kb[0] || ka[1] - kb[1] || byName(a, b);
    }
    return byName(a, b);
  });
  return rows;
}

// ---------- stats ----------

/** "~18 min", "~1 h 5 min", "< 1 min" */
function approxMinutes(ms: number): string {
  return shortWait(ms, ms) ?? "";
}

/**
 * Public stats card text (MAP-05): the parts that have enough data, e.g.
 * ["Avg wait ~18 min", "Avg service ~6 min", "82% of estimates on time"],
 * plus the basis "based on 240 visits in 28 days". `parts` is empty when no
 * average has enough samples yet.
 */
export function statsSummary(stats: BusinessStats): {
  parts: string[];
  basis: string;
} {
  const parts: string[] = [];
  if (stats.avgWaitMs !== null) {
    parts.push(`Avg wait ${approxMinutes(stats.avgWaitMs)}`);
  }
  if (stats.avgServiceMs !== null) {
    parts.push(`Avg service ${approxMinutes(stats.avgServiceMs)}`);
  }
  if (stats.etaAccuracyPct !== null) {
    parts.push(`${stats.etaAccuracyPct}% of estimates on time`);
  }
  const visits = stats.servedCount === 1 ? "visit" : "visits";
  return {
    parts,
    basis: `based on ${stats.servedCount} ${visits} in ${stats.windowDays} days`,
  };
}
