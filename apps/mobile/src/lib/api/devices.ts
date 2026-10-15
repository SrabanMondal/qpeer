import { type DevicePlatform, OkResponse } from "@qpeer/shared";

import { apiFetch } from "@/lib/api/client";

/** POST /v1/me/devices (ALR-02): upsert this phone's Expo push token. */
export function registerDevice(
  expoPushToken: string,
  platform: DevicePlatform,
) {
  return apiFetch("/v1/me/devices", OkResponse, {
    method: "POST",
    body: { expoPushToken, platform },
  });
}

/** DELETE /v1/me/devices/:pushToken (ALR-02, on sign-out). */
export function unregisterDevice(expoPushToken: string) {
  return apiFetch(
    `/v1/me/devices/${encodeURIComponent(expoPushToken)}`,
    OkResponse,
    { method: "DELETE" },
  );
}
