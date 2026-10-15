import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

/** Label left (`inkMuted`), value right (`ink`, bold) — §3. Wraps on large fonts. */
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
      <ThemedText type="body" themeColor="inkMuted" style={styles.label}>
        {label}
      </ThemedText>
      <ThemedText type="body" style={styles.value} selectable={selectable}>
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
  value: { flexShrink: 1, fontWeight: "700", textAlign: "right" },
});
