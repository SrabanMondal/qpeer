import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type StatusTone = "active" | "paused" | "closed";

const TONE: Record<StatusTone, { fill: ThemeColor; dot: ThemeColor }> = {
  active: { fill: "brandSoft", dot: "brand" },
  paused: { fill: "warningSoft", dot: "warning" },
  closed: { fill: "bg", dot: "inkMuted" },
};

/**
 * Status strip (§3): tinted background, coloured dot, a title and a detail
 * line. Teal = active, amber = needs attention/paused, grey = off/closed.
 */
export function StatusBanner({
  tone,
  title,
  detail,
  right,
}: {
  tone: StatusTone;
  title: string;
  detail?: string;
  right?: ReactNode;
}) {
  const theme = useTheme();
  const look = TONE[tone];
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: theme[look.fill], borderColor: theme.border },
        tone === "closed" && styles.bordered,
      ]}
      accessibilityRole="summary"
    >
      <View style={[styles.dot, { backgroundColor: theme[look.dot] }]} />
      <View style={styles.text}>
        <ThemedText type="body" style={styles.title}>
          {title}
        </ThemedText>
        {detail ? (
          <ThemedText type="small" themeColor="inkMuted">
            {detail}
          </ThemedText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  bordered: { borderWidth: 1 },
  dot: { width: 14, height: 14, borderRadius: Radius.pill },
  text: { flex: 1, gap: Spacing.half },
  title: { fontWeight: "700" },
});
