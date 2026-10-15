import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

/** Small uppercase label above a group of cards (`label` type, `inkMuted`). */
export function SectionHeader({
  title,
  right,
}: {
  title: string;
  /** Optional control on the right. */
  right?: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <ThemedText
        type="label"
        themeColor="inkMuted"
        accessibilityRole="header"
        style={styles.title}
      >
        {title.toUpperCase()}
      </ThemedText>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.two,
    marginBottom: -Spacing.two,
    gap: Spacing.two,
  },
  title: { flex: 1, letterSpacing: 0.5 },
});
