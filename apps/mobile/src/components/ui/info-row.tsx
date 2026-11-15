import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

/**
 * Label left (body large, `onSurfaceVariant`), value right (title medium,
 * `onSurface`) — §3. Wraps on large fonts.
 */
export function InfoRow({
  label,
  value,
  selectable = false,
}: {
  label: string;
  value: string;
  selectable?: boolean;
}) {
  return (
    <View style={styles.row}>
      <ThemedText
        type="bodyLarge"
        themeColor="onSurfaceVariant"
        style={styles.label}
      >
        {label}
      </ThemedText>
      <ThemedText
        type="titleMedium"
        style={styles.value}
        selectable={selectable}
      >
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    columnGap: Spacing.three,
    rowGap: Spacing.half,
    paddingVertical: Spacing.one,
  },
  label: { flexShrink: 0 },
  value: { flexShrink: 1, textAlign: "right" },
});
