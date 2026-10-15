import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { Spacing } from "@/constants/theme";

export type Stat = { label: string; value: number | string; icon: IconName };

/** Equal columns: caption above, icon + big number below (§3, Waiting / In service / Total). */
export function StatRow({ stats }: { stats: readonly Stat[] }) {
  return (
    <Card style={styles.row}>
      {stats.map((s) => (
        <View
          key={s.label}
          style={styles.col}
          accessible
          accessibilityLabel={`${s.label}: ${s.value}`}
        >
          <ThemedText type="small" themeColor="inkMuted">
            {s.label}
          </ThemedText>
          <View style={styles.value}>
            <Icon name={s.icon} size={22} color="primary" />
            <ThemedText type="title">{String(s.value)}</ThemedText>
          </View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-around" },
  col: { flex: 1, alignItems: "center", gap: Spacing.one },
  value: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
});
