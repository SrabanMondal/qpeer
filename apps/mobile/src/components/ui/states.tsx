import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/lib/api/client";
import { errorText } from "@/lib/error-messages";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.centre} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={theme.primary} />
      <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
        {label}
      </ThemedText>
    </View>
  );
}

/** Friendly block for "nothing here yet" and for tabs whose step is not built yet. */
export function EmptyState({
  title,
  message,
  icon,
  action,
}: {
  title: string;
  message?: string;
  icon?: IconName;
  /** Usually a Button that fixes the emptiness ("Create your first business"). */
  action?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.emptyCard} tone="surfaceContainerLow">
      {icon ? (
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: theme.secondaryContainer },
          ]}
        >
          <Icon name={icon} size={32} color="onSecondaryContainer" />
        </View>
      ) : null}
      <ThemedText type="titleLarge" style={styles.centredText}>
        {title}
      </ThemedText>
      {message ? (
        <ThemedText
          type="bodyMedium"
          themeColor="onSurfaceVariant"
          style={styles.centredText}
        >
          {message}
        </ThemedText>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </Card>
  );
}

/**
 * Friendly message, then the error code and request ID for support
 * (PLT-09, NFR-12), then Retry.
 */
export function ErrorState({
  error,
  onRetry,
  retrying = false,
  title = "Something went wrong",
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  title?: string;
}) {
  const api = error instanceof ApiError ? error : null;
  return (
    <Card>
      <View style={styles.errorHead}>
        <Icon name="error" color="error" />
        <ThemedText type="titleMedium" themeColor="error" style={styles.flex}>
          {title}
        </ThemedText>
      </View>
      <ThemedText type="bodyLarge">{errorText(error)}</ThemedText>
      {api ? (
        <ThemedText type="bodySmall" themeColor="onSurfaceVariant" selectable>
          Code: {api.code}
          {api.status ? ` (HTTP ${api.status})` : ""}
          {api.requestId ? `\nRequest ID: ${api.requestId}` : ""}
        </ThemedText>
      ) : null}
      {onRetry ? (
        <Button
          title="Retry"
          variant="tonal"
          icon="refresh"
          onPress={onRetry}
          loading={retrying}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  centre: {
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  emptyCard: {
    alignItems: "center",
    paddingVertical: Spacing.four,
    gap: Spacing.twoHalf,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  centredText: { textAlign: "center" },
  action: { alignSelf: "stretch", marginTop: Spacing.two },
  errorHead: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  flex: { flex: 1 },
});
