import type { LatLng } from "@qpeer/shared";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Standard geohash. Precision 9 is about 5 m; stored for later clustering. */
export function geohash({ lat, lng }: LatLng, precision = 9): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";
  let bits = 0;
  let bitCount = 0;
  let evenBit = true; // even bits encode longitude

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        bits = (bits << 1) | 1;
        lngMin = mid;
      } else {
        bits <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bits = (bits << 1) | 1;
        latMin = mid;
      } else {
        bits <<= 1;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    if (++bitCount === 5) {
      hash += BASE32[bits];
      bits = 0;
      bitCount = 0;
    }
  }
  return hash;
}

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Box around a point with the given radius in metres (map queries, Step 3). */
export function boundingBox(center: LatLng, radiusM: number): BoundingBox {
  const dLat = radiusM / 111_320;
  const cos = Math.cos((center.lat * Math.PI) / 180);
  const dLng = cos > 1e-9 ? radiusM / (111_320 * cos) : 180;
  return {
    minLat: Math.max(-90, center.lat - dLat),
    maxLat: Math.min(90, center.lat + dLat),
    minLng: Math.max(-180, center.lng - dLng),
    maxLng: Math.min(180, center.lng + dLng),
  };
}
