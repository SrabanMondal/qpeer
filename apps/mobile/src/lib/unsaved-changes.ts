import { useFocusEffect, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useCallback, useRef } from "react";
import { BackHandler } from "react-native";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

function confirmDiscard(): Promise<boolean> {
  return ConfirmDialog.show({
    title: "Discard changes?",
    message: "Your changes have not been saved.",
    confirmLabel: "Discard",
    cancelLabel: "Keep editing",
  });
}

/**
 * B8: while `dirty`, leaving a pushed screen (header back, Android back,
 * swipe) asks "Discard changes?" (Keep editing / Discard). Use one per screen.
 *
 * Returns `allowLeave()`: call it right before navigating away after a
 * successful save, so that navigation is not interrupted.
 */
export function useUnsavedChangesGuard(dirty: boolean): () => void {
  const navigation = useNavigation();
  const leaving = useRef(false);

  usePreventRemove(dirty, ({ data }) => {
    if (leaving.current) {
      navigation.dispatch(data.action);
      return;
    }
    void confirmDiscard().then((discard) => {
      if (discard) navigation.dispatch(data.action);
    });
  });

  return useCallback(() => {
    leaving.current = true;
  }, []);
}

/**
 * B8 for an editor inside a tab (the screen itself is never removed): while
 * `dirty` and the tab is focused, Android back asks first; Discard calls
 * `onDiscard` (e.g. close the editor) instead of navigating.
 */
export function useBackPressGuard(dirty: boolean, onDiscard: () => void) {
  useFocusEffect(
    useCallback(() => {
      if (!dirty) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        void confirmDiscard().then((discard) => {
          if (discard) onDiscard();
        });
        return true;
      });
      return () => sub.remove();
    }, [dirty, onDiscard]),
  );
}
