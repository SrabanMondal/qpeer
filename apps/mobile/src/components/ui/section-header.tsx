import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

/**
 * M3 list subheader above a group: title small in `primary`, sentence case.
 * Space above it separates the group; no divider.
 */
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
        type="titleSmall"
        themeColor="primary"
        accessibilityRole="header"
        style={styles.title}
      >
        {title}
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
    marginBottom: -Spacing.one,
    gap: Spacing.two,
  },
  title: { flex: 1 },
});
