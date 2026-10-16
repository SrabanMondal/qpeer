import type { LatLng } from "@qpeer/shared";
import * as Location from "expo-location";

import { type LocationProblem, withTimeout } from "@/lib/join-location";

/**
 * The user's position for the map and list (MAP-01, MAP-07). Kept in memory
 * only (centre the map, show distances); never sent to the API or logged.
 */

const QUIET_MAX_AGE_MS = 5 * 60_000;
const FIX_TIMEOUT_MS = 15_000;

function toLatLng(fix: Location.LocationObject): LatLng {
  return { lat: fix.coords.latitude, lng: fix.coords.longitude };
}

/**
 * The phone's position without asking anything: only when location
 * permission was already granted and a recent reading is at hand (MAP-01:
 * "don't prompt on open"). Null otherwise; never throws.
 */
export async function quietUserLocation(): Promise<LatLng | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    if (!(await Location.hasServicesEnabledAsync())) return null;
    const last = await Location.getLastKnownPositionAsync({
      maxAge: QUIET_MAX_AGE_MS,
    });
    if (last) return toLatLng(last);
    const fix = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      FIX_TIMEOUT_MS,
    );
    return toLatLng(fix);
  } catch {
    return null;
  }
}

export type LocateResult =
  | { ok: true; position: LatLng }
  | { ok: false; problem: LocationProblem };

/**
 * Recenter (MAP-07): asks for when-in-use permission, checks the location
 * switch, then uses a fresh last-known reading or takes one.
 */
export async function locateUser(): Promise<LocateResult> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      return {
        ok: false,
        problem: { kind: "denied", canAskAgain: perm.canAskAgain },
      };
    }
    if (!(await Location.hasServicesEnabledAsync())) {
      return { ok: false, problem: { kind: "services_off" } };
    }
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
    if (last) return { ok: true, position: toLatLng(last) };
    const fix = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      FIX_TIMEOUT_MS,
    );
    return { ok: true, position: toLatLng(fix) };
  } catch {
    const on = await Location.hasServicesEnabledAsync().catch(() => true);
    return {
      ok: false,
      problem: on ? { kind: "no_fix" } : { kind: "services_off" },
    };
  }
}

/** Map-specific wording for a failed recenter. */
export function locateProblemText(p: LocationProblem): {
  title: string;
  message: string;
} {
  switch (p.kind) {
    case "denied":
      return {
        title: "Location permission is off",
        message: p.canAskAgain
          ? "Allow location to see queues near you. You can still move the map by hand."
          : "Turn on location permission for Qpeer in Settings to see queues near you. You can still move the map by hand.",
      };
    case "services_off":
      return {
        title: "Your phone's location is off",
        message: "Turn on location to centre the map on you.",
      };
    default:
      return {
        title: "Could not find your location",
        message: "Try again near a window or outside, or move the map by hand.",
      };
  }
}
