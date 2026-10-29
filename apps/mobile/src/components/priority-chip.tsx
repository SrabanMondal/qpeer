import { priorityLaneLabel, type QueuePriorityInfo } from "@qpeer/shared";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * PRI-07 (design guide §5a): "Priority lane on · 1 in N" as a small
 * `brandSoft` pill. Never hidden while the lane is on; nothing when off.
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
      style={[styles.pill, { backgroundColor: theme.brandSoft }]}
      accessibilityRole="text"
      accessibilityLabel={`${label}: one priority customer for every ${priority?.perRegular} regular customers`}
    >
      <Icon name="bolt" size={16} color="brand" />
      <ThemedText type="label">{label}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    alignSelf: "flex-start",
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.twoHalf,
    paddingVertical: Spacing.one,
  },
});
