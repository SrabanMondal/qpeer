import type { JoinBody } from "@qpeer/shared";
import * as Location from "expo-location";
import { Linking, Platform } from "react-native";

/**
 * The walk-in GPS check's one location reading (JON-04/05/06, B5).
 * The coordinates go straight into the join request: they are never stored,
 * cached or logged by the app.
 */

const FIX_TIMEOUT_MS = 20_000;

export type LocationProblem =
  /** Permission refused; `canAskAgain` false means only Settings can fix it. */
  | { kind: "denied"; canAskAgain: boolean }
  /** The phone's location (GPS) is switched off. */
  | { kind: "services_off" }
  /** No reading in time (indoors, no GPS signal). */
  | { kind: "no_fix" };

export type JoinLocationResult =
  | { ok: true; body: JoinBody }
  | { ok: false; problem: LocationProblem };

class FixTimeout extends Error {}

/** Rejects with a timeout error when `p` takes longer than `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FixTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Asks for when-in-use permission, checks the location switch, takes one high-accuracy reading. */
export async function readJoinLocation(): Promise<JoinLocationResult> {
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
  try {
    const fix = await withTimeout(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      }),
      FIX_TIMEOUT_MS,
    );
    return {
      ok: true,
      body: {
        lat: fix.coords.latitude,
        lng: fix.coords.longitude,
        accuracyM: Math.max(0, Math.min(100_000, fix.coords.accuracy ?? 1000)),
        mocked: fix.mocked === true,
      },
    };
  } catch {
    // The switch may have been turned off meanwhile; tell which.
    const on = await Location.hasServicesEnabledAsync().catch(() => true);
    return {
      ok: false,
      problem: on ? { kind: "no_fix" } : { kind: "services_off" },
    };
  }
}

/**
 * "Turn on location": Android's in-app dialog (Google Play services) when
 * available, else the system location settings. Resolves true when location
 * is on afterwards.
 */
export async function turnOnLocation(): Promise<boolean> {
  if (Platform.OS === "android") {
    try {
      await Location.enableNetworkProviderAsync();
      return await Location.hasServicesEnabledAsync();
    } catch {
      // Dialog refused or not available: open the settings screen.
    }
    try {
      await Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS");
      return false;
    } catch {
      // Fall through.
    }
  }
  await Linking.openSettings();
  return false;
}
