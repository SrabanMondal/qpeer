import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

export type Stat = {
  label: string;
  value: number | string;
};

/**
 * Figures in equal columns (§3, Waiting / In service / Total): caption in
 * body medium above, the number in Archivo (`figure`, tabular) below. No
 * card: space and type make the group.
 */
export function StatRow({ stats }: { stats: readonly Stat[] }) {
  return (
    <View style={styles.row}>
      {stats.map((s) => (
        <View
          key={s.label}
          style={styles.col}
          accessible
          accessibilityLabel={`${s.label}: ${s.value}`}
        >
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {s.label}
          </ThemedText>
          <ThemedText type="figure">{String(s.value)}</ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: Spacing.three },
  col: { flex: 1, gap: Spacing.half },
});
