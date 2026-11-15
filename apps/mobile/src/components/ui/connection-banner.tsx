import { useQueryClient } from "@tanstack/react-query";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { HeaderButton } from "@/components/ui/header-button";
import { Icon } from "@/components/ui/icon";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth";
import { retryNetworkFailures, useOffline } from "@/lib/network";

/**
 * The one connection strip (B13, INC-040), slim and the same on every
 * screen: "Offline — showing saved info" while API requests fail with
 * network errors, "Connecting…" while the automatic sign-in is retried.
 * Screens never block on it: they keep showing what they last had, and
 * actions that need the server are disabled with `OFFLINE_ACTION_TEXT`.
 * A calm tonal strip: the icon and the words carry the meaning.
 */
export function ConnectionBanner() {
  const { connecting, retry } = useAuth();
  const offline = useOffline();
  const queryClient = useQueryClient();
  const theme = useTheme();

  if (!connecting && !offline) return null;
  const text = offline ? "Offline — showing saved info" : "Connecting…";
  const onRetry = offline ? () => retryNetworkFailures(queryClient) : retry;

  return (
    <View
      style={[styles.strip, { backgroundColor: theme.surfaceContainerHighest }]}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
    >
      <Icon
        name={offline ? "cloud_off" : "sync"}
        size={18}
        color="onSurfaceVariant"
      />
      <ThemedText type="labelLarge" style={styles.text} numberOfLines={1}>
        {text}
      </ThemedText>
      <HeaderButton
        title="Retry"
        accessibilityLabel="Retry now"
        onPress={onRetry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 48,
    paddingLeft: Spacing.twoHalf,
    borderRadius: Radius.md,
  },
  text: { flex: 1 },
});
