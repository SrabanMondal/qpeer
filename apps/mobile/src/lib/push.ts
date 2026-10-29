import { AlertKind, PUSH_CHANNEL_ID } from "@qpeer/shared";
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { AppState, Linking, Platform } from "react-native";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { registerDevice, unregisterDevice } from "@/lib/api/devices";
import { onBeforeSignOut, useAuth } from "@/lib/auth";
import { showToast, type ToastTone } from "@/lib/toast";

/**
 * Queue alerts (M6): Android channel (ALR-06), permission at first join
 * (ALR-01), Expo push token registration (ALR-02), foreground banner and
 * tap → ticket (ALR-05).
 */

// Foreground: no system heads-up banner (the in-app banner shows instead),
// but keep it in the notification list and play the sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let channelReady: Promise<void> | null = null;

/** Creates the high-importance `queue-alerts` channel (ALR-06). Safe to call often. */
export function ensureAlertChannel(): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    name: "Queue alerts",
    description: "Your turn, head back now, queue paused or closed",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 300, 200, 300],
  }).then(
    () => undefined,
    () => {
      channelReady = null;
    },
  );
  return channelReady;
}

/** The token registered with the API in this app run, and for which user. */
let registered: { token: string; uid: string } | null = null;
let registering: Promise<void> | null = null;

function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

async function currentExpoToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return null;
  await ensureAlertChannel();
  const { data } = await Notifications.getExpoPushTokenAsync({
    projectId: easProjectId(),
  });
  return data;
}

/**
 * Registers this phone's Expo push token for `uid` (ALR-02). Does nothing
 * without notification permission or when already registered for this user.
 */
export function registerPushDevice(uid: string, force = false): Promise<void> {
  registering ??= (async () => {
    try {
      const token = await currentExpoToken();
      if (!token) return;
      if (!force && registered?.token === token && registered.uid === uid) {
        return;
      }
      await registerDevice(token, Platform.OS === "ios" ? "ios" : "android");
      registered = { token, uid };
    } finally {
      registering = null;
    }
  })();
  return registering;
}

/**
 * Removes this phone's push token from the signed-in account (ALR-02). Called
 * before sign-out; never blocks it for more than a few seconds.
 */
export async function unregisterPushDevice(): Promise<void> {
  const attempt = (async () => {
    const token = registered?.token ?? (await currentExpoToken());
    registered = null;
    if (token) await unregisterDevice(token);
  })().catch(() => {
    // Offline: the server drops dead tokens via push receipts anyway.
  });
  await Promise.race([
    attempt,
    new Promise<void>((resolve) => setTimeout(resolve, 4000)),
  ]);
}

// ALR-02: on sign-out, DELETE the token first (while the old user is signed in).
onBeforeSignOut(unregisterPushDevice);

/**
 * After a successful join (ALR-01): explain, ask for notification permission
 * once, then register the token. Never throws.
 */
export async function askForAlertsAfterJoin(uid: string): Promise<void> {
  try {
    if (!Device.isDevice) return;
    await ensureAlertChannel();
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) return;
      const ok = await ConfirmDialog.show({
        title: "Get alerts for your turn?",
        message:
          "Qpeer tells you when to head back, when you are next and when you are called, even when the app is closed.",
        confirmLabel: "Allow alerts",
        cancelLabel: "Not now",
        destructive: false,
      });
      if (!ok) return;
      const asked = await Notifications.requestPermissionsAsync();
      if (!asked.granted) return;
    }
    await registerPushDevice(uid);
  } catch {
    // Alerts are a bonus: the ticket still updates live in the app.
  }
}

export type AlertPermission = "granted" | "denied" | "undetermined";

export async function alertPermission(): Promise<AlertPermission> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.granted) return "granted";
    return perm.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "undetermined";
  }
}

/** Opens Android's battery optimisation list (ALR-06), else the app settings. */
export async function openBatterySettings(): Promise<void> {
  if (Platform.OS === "android") {
    try {
      await Linking.sendIntent(
        "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS",
      );
      return;
    } catch {
      // Some phones hide this screen; fall back to the app's settings.
    }
  }
  await Linking.openSettings();
}

const TONE_FOR_KIND: Record<AlertKind, ToastTone> = {
  head_back: "info",
  next: "info",
  called: "success",
  grace_started: "warning",
  refund_issued: "info",
  queue_paused: "warning",
  queue_closed: "warning",
  missed: "warning",
};

function tokenIdOf(data: Record<string, unknown> | undefined): string | null {
  const id = data?.tokenId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function openTicket(tokenId: string) {
  router.push({ pathname: "/token/[id]", params: { id: tokenId } });
}

/**
 * Mounted once in the root layout: creates the channel, registers the push
 * token for the signed-in user (again when the token or user changes or a
 * failed registration can be retried), shows foreground alerts as an in-app
 * banner and opens the ticket when an alert is tapped (also on cold start).
 */
export function usePushSetup() {
  const uid = useAuth().user?.uid ?? null;
  const queryClient = useQueryClient();
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    void ensureAlertChannel();
  }, []);

  useEffect(() => {
    if (!uid) return;
    let failed = false;
    const attempt = (force = false) => {
      registerPushDevice(uid, force).then(
        () => {
          failed = false;
        },
        () => {
          failed = true;
        },
      );
    };
    attempt();
    // The push service rolled the token: register the new one (ALR-02).
    const tokenSub = Notifications.addPushTokenListener(() => attempt(true));
    const appSub = AppState.addEventListener("change", (s) => {
      if (s === "active" && failed) attempt();
    });
    return () => {
      tokenSub.remove();
      appSub.remove();
    };
  }, [uid]);

  // Foreground alerts: in-app banner, and refresh the ticket data.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const content = n.request.content;
      const tokenId = tokenIdOf(content.data);
      void queryClient.invalidateQueries({ queryKey: ["token"] });
      void queryClient.invalidateQueries({ queryKey: ["tokens"] });
      const kind = AlertKind.safeParse(content.data?.kind);
      if (kind.success && kind.data === "refund_issued") {
        void queryClient.invalidateQueries({ queryKey: ["payments"] });
      }
      showToast({
        title: content.title ?? "Queue update",
        message: content.body ?? undefined,
        tone: kind.success ? TONE_FOR_KIND[kind.data] : "info",
        durationMs: 8000,
        onPress: tokenId ? () => openTicket(tokenId) : undefined,
      });
    });
    return () => sub.remove();
  }, [queryClient]);

  // Tapped alert (warm or cold start) → that token's ticket (ALR-05).
  useEffect(() => {
    if (!lastResponse) return;
    if (
      lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
    ) {
      return;
    }
    const tokenId = tokenIdOf(lastResponse.notification.request.content.data);
    Notifications.clearLastNotificationResponse();
    if (tokenId) openTicket(tokenId);
  }, [lastResponse]);
}
