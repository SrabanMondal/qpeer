import { Alert } from "react-native";

type ConfirmOptions = {
  title: string;
  message?: string;
  /** Label of the confirming button, e.g. "Deactivate". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (iOS; Android shows plain text). */
  destructive?: boolean;
};

/**
 * Asks before a destructive action (NFR-13). Resolves true only when the user
 * taps the confirm button; Cancel, back button or tapping outside give false.
 *
 * ```ts
 * if (await ConfirmDialog.show({ title: "Archive queue?", confirmLabel: "Archive", destructive: true })) { … }
 * ```
 */
export const ConfirmDialog = {
  show({
    title,
    message,
    confirmLabel,
    cancelLabel = "Cancel",
    destructive = true,
  }: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(
        title,
        message,
        [
          { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
          {
            text: confirmLabel,
            style: destructive ? "destructive" : "default",
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  },
};
