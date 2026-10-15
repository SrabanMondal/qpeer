import type { AppMode } from "@qpeer/shared";
import { router } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";

import { useMe, useUpdateMe } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorText } from "@/lib/error-messages";

/**
 * IDN-08: the app mode comes from `/v1/me` (`preferredMode`), so it is restored
 * on every launch and device. Business mode needs a registered user; everyone
 * else (and anyone who never chose) is in Customer mode.
 */
export function useAppMode() {
  const { user } = useAuth();
  const me = useMe();
  const update = useUpdateMe();
  const { mutateAsync } = update;
  const registered = user !== null && !user.isAnonymous;
  const mode: AppMode =
    registered && me.data?.user.preferredMode === "business"
      ? "business"
      : "customer";

  /** Saves the mode, then opens that mode's home tab. */
  const switchMode = useCallback(
    async (next: AppMode) => {
      await mutateAsync({ preferredMode: next });
      goHome(next);
    },
    [mutateAsync],
  );

  return {
    mode,
    me,
    registered,
    switchMode,
    switching: update.isPending,
  };
}

/**
 * What the mode switches (Profile, Business tab header) call. Anonymous users
 * who pick Business are sent to sign in first; sign-in then switches.
 */
export function useModeToggle() {
  const { mode, registered, switchMode, switching } = useAppMode();
  const change = useCallback(
    async (next: AppMode) => {
      if (next === mode) return;
      if (next === "business" && !registered) {
        router.push({ pathname: "/sign-in", params: { mode: "business" } });
        return;
      }
      try {
        await switchMode(next);
      } catch (e) {
        Alert.alert(
          "Could not switch mode",
          `${errorText(e)} Your mode did not change.`,
        );
      }
    },
    [mode, registered, switchMode],
  );
  return { mode, registered, switching, change };
}

/**
 * Closes pushed screens and opens the home tab of `mode`: Customer → Home,
 * Business → Business (the dashboard with the mode switch).
 */
export function goHome(mode: AppMode) {
  if (router.canDismiss()) router.dismissAll();
  router.navigate(mode === "business" ? "/business" : "/");
}
