import { priorityLaneLabel, type QueuePriorityInfo } from "@qpeer/shared";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * PRI-07 (design guide §5a): "Priority lane on · 1 in N" as a small
 * `primaryContainer` chip (radius 8). Never hidden while the lane is on;
 * nothing when off.
 */
export function PriorityChip({
  priority,
}: {
  priority: QueuePriorityInfo | null | undefined;
}) {
  const theme = useTheme();
  const label = priority ? priorityLaneLabel(priority) : null;
  if (!label) return null;
  return (
    <View
      style={[styles.pill, { backgroundColor: theme.primaryContainer }]}
      accessibilityRole="text"
      accessibilityLabel={`${label}: one priority customer for every ${priority?.perRegular} regular customers`}
    >
      <Icon name="bolt" size={18} color="onPrimaryContainer" />
      <ThemedText type="labelLarge" themeColor="onPrimaryContainer">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    alignSelf: "flex-start",
    minHeight: 32,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
});
