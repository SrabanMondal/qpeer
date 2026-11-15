import {
  type MapBusiness,
  markerStatus,
  summaryWait,
  waitSummary,
} from "@qpeer/shared";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Button, Card, Icon, IconButton } from "@/components/ui";
import { Elevation, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useBusiness } from "@/lib/api";
import { openDirections } from "@/lib/directions";
import { categoryIcon, categoryLabel } from "@/lib/format";
import { useNow } from "@/lib/queue-format";
import { StatusPill } from "@/screens/discover/status-pill";

/**
 * Bottom card for the tapped marker (design guide `BottomSheetCard`,
 * MAP-02): name, category, address, open/closed + today's hours, waiting +
 * wait range, View details and Directions.
 */
export function BusinessCard({
  business: b,
  onClose,
  onDetails,
}: {
  business: MapBusiness;
  onClose: () => void;
  onDetails: () => void;
}) {
  const theme = useTheme();
  // Today's hours are not in the map payload: the detail fills them in (and
  // is then cached for the detail page).
  const detail = useBusiness(b.id);
  const today = detail.data?.todayHours.text;
  const now = useNow(true, 30_000);
  const status = markerStatus(b);

  return (
    // It floats over the map: a tonal card with the level 3 shadow.
    <Card
      tone="surfaceContainerLow"
      style={[styles.card, { boxShadow: Elevation.level3 }]}
    >
      <View style={styles.header}>
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: theme.secondaryContainer },
          ]}
        >
          <Icon
            name={categoryIcon(b.category)}
            size={24}
            color="onSecondaryContainer"
          />
        </View>
        <View style={styles.title}>
          <ThemedText type="titleMedium" numberOfLines={2}>
            {b.name}
          </ThemedText>
          <ThemedText
            type="bodyMedium"
            themeColor="onSurfaceVariant"
            numberOfLines={1}
          >
            {categoryLabel(b.category)}
            {b.address ? ` · ${b.address}` : ""}
          </ThemedText>
        </View>
        <View style={styles.close}>
          <IconButton
            icon="close"
            accessibilityLabel="Close"
            onPress={onClose}
          />
        </View>
      </View>

      <View style={styles.row}>
        <StatusPill status={status} isOpenNow={b.isOpenNow} />
        <ThemedText
          type="bodyMedium"
          themeColor="onSurfaceVariant"
          style={styles.flex}
        >
          {today ? `Today: ${today}` : detail.isError ? "" : "Today: …"}
        </ThemedText>
      </View>

      <View style={styles.row}>
        <Icon name="groups" size={20} color="onSurfaceVariant" />
        <ThemedText type="bodyLarge">
          {status === "closed"
            ? "Not taking walk-ins now"
            : waitSummary(summaryWait(b), now)}
        </ThemedText>
      </View>

      <View style={styles.buttons}>
        <Button
          title="View details"
          icon="info"
          onPress={onDetails}
          style={styles.flex}
          accessibilityLabel={`View details of ${b.name}`}
        />
        <Button
          title="Directions"
          variant="outlined"
          icon="directions"
          onPress={() => openDirections(b.location.lat, b.location.lng, b.name)}
          style={styles.flex}
          accessibilityLabel={`Directions to ${b.name}`}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.twoHalf },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.twoHalf,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, gap: Spacing.half },
  close: { marginTop: -Spacing.twoHalf, marginRight: -Spacing.twoHalf },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  buttons: { flexDirection: "row", gap: Spacing.two },
  flex: { flex: 1 },
});
