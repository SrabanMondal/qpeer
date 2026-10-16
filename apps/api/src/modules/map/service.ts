import {
  isOpenAt,
  type MapBusiness,
  type MapQuery,
  type MapQueue,
  type MapResponse,
  type WeeklyHours,
} from "@qpeer/shared";

/** One row per (business, active queue); snapshot columns are null before the first snapshot. */
interface MapRow {
  id: string;
  name: string;
  category: MapBusiness["category"];
  address: string;
  lat: number;
  lng: number;
  hours_json: string;
  queue_id: string;
  queue_name: string;
  is_open: number | null;
  is_paused: number | null;
  waiting: number | null;
  eta_low_ms: number | null;
  eta_high_ms: number | null;
  updated_at: number | null;
  in_service: number | null;
}

/**
 * MAP-01…04 in **one** D1 statement (NFR-04): the CTE picks listed businesses
 * (BIZ-07: active, pinned, ≥ 1 active queue) inside the box — the range on
 * `lat` uses idx(status, lat, lng) — nearest to the box centre first, `limit + 1`
 * of them so we can tell when the result is truncated. The outer select joins
 * their active queues and the queues' snapshots.
 *
 * `openNow` is evaluated in SQL with the same rule as the badge
 * (`markerStatus` = "open": a queue open and not paused; B16), so the limit
 * applies after the filter.
 */
export async function mapQuery(
  d1: D1Database,
  q: MapQuery,
  now: number,
): Promise<MapResponse> {
  const { sql, params } = mapSql(q, now);
  const { results } = await d1
    .prepare(sql)
    .bind(...params)
    .all<MapRow>();

  const byId = new Map<string, { row: MapRow; queues: MapQueue[] }>();
  for (const r of results) {
    let entry = byId.get(r.id);
    if (!entry) {
      entry = { row: r, queues: [] };
      byId.set(r.id, entry);
    }
    entry.queues.push({
      id: r.queue_id,
      name: r.queue_name,
      isOpen: r.is_open === 1,
      isPaused: r.is_paused === 1,
      waiting: r.waiting ?? 0,
      waitLowMs: r.eta_low_ms,
      waitHighMs: r.eta_high_ms,
      updatedAt: r.updated_at,
      inService: r.in_service ?? 0,
    });
  }

  const entries = [...byId.values()];
  const truncated = entries.length > q.limit;
  const items = entries
    .slice(0, q.limit)
    .map(({ row, queues }) => mapBusiness(row, queues, now));
  return { items, truncated, serverTime: now };
}

/** The single map statement and its parameters (exported for the query-plan test). */
export function mapSql(
  q: MapQuery,
  // Unused since B16 (openNow no longer reads the hours); kept so callers
  // don't change if a time-based filter comes back.
  _now: number,
): { sql: string; params: unknown[] } {
  const cLat = (q.minLat + q.maxLat) / 2;
  const cLng = (q.minLng + q.maxLng) / 2;
  // Longitude degrees shrink with latitude; good enough for ordering.
  const k = Math.cos((cLat * Math.PI) / 180) ** 2;

  // Only fixed SQL fragments are concatenated; every value is a bound parameter.
  const filters: string[] = [];
  const params: unknown[] = [
    cLat,
    cLat,
    cLng,
    cLng,
    k,
    q.minLat,
    q.maxLat,
    q.minLng,
    q.maxLng,
  ];
  if (q.category) {
    filters.push("AND biz.category = ?");
    params.push(q.category);
  }
  if (q.openNow) {
    // B16 (INC-043): the same rule as the badge (`markerStatus` = "open"):
    // some active queue is open and not paused. Hours don't matter.
    filters.push(`AND EXISTS (
        SELECT 1 FROM queues oq JOIN queue_snapshots os ON os.queue_id = oq.id
        WHERE oq.business_id = biz.id AND oq.status = 'active'
          AND os.is_open = 1 AND os.is_paused = 0
      )`);
  }
  params.push(q.limit + 1);

  const sql = `
    WITH listed AS (
      SELECT biz.id, biz.name, biz.category, biz.address, biz.lat, biz.lng, biz.hours_json,
             (biz.lat - ?) * (biz.lat - ?) + (biz.lng - ?) * (biz.lng - ?) * ? AS d
      FROM businesses biz
      WHERE biz.status = 'active'
        AND biz.lat BETWEEN ? AND ?
        AND biz.lng BETWEEN ? AND ?
        AND EXISTS (SELECT 1 FROM queues aq WHERE aq.business_id = biz.id AND aq.status = 'active')
        ${filters.join("\n        ")}
      ORDER BY d, biz.id
      LIMIT ?
    )
    SELECT l.id, l.name, l.category, l.address, l.lat, l.lng, l.hours_json,
           q.id AS queue_id, q.name AS queue_name,
           s.is_open, s.is_paused, s.waiting, s.eta_low_ms, s.eta_high_ms, s.updated_at, s.in_service
    FROM listed l
    JOIN queues q ON q.business_id = l.id AND q.status = 'active'
    LEFT JOIN queue_snapshots s ON s.queue_id = q.id
    ORDER BY l.d, l.id, q.created_at, q.id`;
  return { sql, params };
}

function mapBusiness(
  row: MapRow,
  queues: MapQueue[],
  now: number,
): MapBusiness {
  const hours = JSON.parse(row.hours_json) as WeeklyHours;
  // Shortest wait among queues people can join right now.
  let best: MapQueue | null = null;
  for (const q of queues) {
    if (!q.isOpen || q.isPaused || q.waitLowMs === null) continue;
    if (best === null || q.waitLowMs < (best.waitLowMs ?? Infinity)) best = q;
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.address,
    location: { lat: row.lat, lng: row.lng },
    isOpenNow: isOpenAt(hours, now),
    queues,
    summary: {
      waiting: queues.reduce((n, q) => n + q.waiting, 0),
      waitLowMs: best?.waitLowMs ?? null,
      waitHighMs: best?.waitHighMs ?? null,
      anyOpen: queues.some((q) => q.isOpen),
      // B19: "No wait" vs "Next in ~N min" for the queue whose wait is shown.
      inService: best?.inService ?? 0,
      updatedAt: best?.updatedAt ?? null,
    },
  };
}
