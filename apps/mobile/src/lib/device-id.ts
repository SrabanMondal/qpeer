import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { getAndroidId } from "expo-application";
import { Platform } from "react-native";

/**
 * C2 (INC-042): a stable, private device key for fairness rules. Android
 * keeps ANDROID_ID for this app across reinstalls (it changes only on a
 * factory reset or a new signing key), so a reinstall can't get a second
 * free walk-in ticket. The app sends only SHA-256(ANDROID_ID + salt); the
 * raw id never leaves the phone and is never stored.
 *
 * The salt is fixed and public: it only keeps our hash from matching other
 * apps' hashes of the same id.
 */
const DEVICE_SALT = "qpeer-device-v1:";

let cached: string | null | undefined;

/** Hex SHA-256 of ANDROID_ID + salt, or null (not Android, or no id). */
export function deviceHash(): string | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== "android") return cached;
  try {
    const id = getAndroidId();
    if (id) cached = bytesToHex(sha256(utf8ToBytes(DEVICE_SALT + id)));
  } catch {
    cached = null;
  }
  return cached;
}
