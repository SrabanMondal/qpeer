import { useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
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
      style={[
        styles.strip,
        { backgroundColor: theme.warningSoft, borderColor: theme.border },
      ]}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
    >
      <Icon name={offline ? "cloud_off" : "sync"} size={18} color="warning" />
      <ThemedText type="small" style={styles.text} numberOfLines={1}>
        {text}
      </ThemedText>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry now"
        hitSlop={8}
        style={styles.retry}
      >
        <ThemedText type="label" themeColor="primary">
          Retry
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 36,
    paddingLeft: Spacing.twoHalf,
    borderRadius: Radius.input,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, fontWeight: "600" },
  retry: {
    minHeight: 36,
    minWidth: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.twoHalf,
  },
});
