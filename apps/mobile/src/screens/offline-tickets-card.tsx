import { isActiveState } from "@qpeer/shared";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, Card, Icon, ListItem } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth";
import { formatAge, ticketTitle } from "@/lib/queue-format";
import { useSavedTickets } from "@/lib/storage";

/**
 * B13/B14 (INC-040/041): the calm card shown instead of a blank map when
 * there is no internet or the map can't load. The user's active tickets
 * (saved on the phone, C1) are one tap away.
 */
export function OfflineTicketsCard({
  title = "The map needs internet",
  message = "Queues and the map come back by themselves when you're online.",
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const theme = useTheme();
  const uid = useAuth().user?.uid ?? null;
  const { tickets } = useSavedTickets(uid);
  const active = tickets.filter((t) => isActiveState(t.view.state));

  return (
    <Card style={styles.card} tone="surfaceContainerLow">
      <View style={styles.head}>
        <View
          style={[styles.icon, { backgroundColor: theme.secondaryContainer }]}
        >
          <Icon name="cloud_off" color="onSecondaryContainer" />
        </View>
        <View style={styles.flex}>
          <ThemedText type="titleMedium">{title}</ThemedText>
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {message}
          </ThemedText>
        </View>
      </View>
      {active.map((t) => (
        <ListItem
          key={t.view.id}
          icon="confirmation_number"
          title={`${ticketTitle(t.view)} · ${t.view.queueName}`}
          subtitle={`${t.view.businessName} · updated ${formatAge(t.savedAt)}`}
          onPress={() =>
            router.push({
              pathname: "/token/[id]",
              params: { id: t.view.id },
            })
          }
        />
      ))}
      {onRetry ? (
        <Button
          title="Try again"
          variant="tonal"
          icon="refresh"
          onPress={onRetry}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.twoHalf },
  head: { flexDirection: "row", alignItems: "center", gap: Spacing.twoHalf },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  flex: { flex: 1, gap: Spacing.half },
});
