import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type BadgeTone = "success" | "warning" | "danger" | "neutral";

/** Container roles with their on-colours (pairs only, §2). */
const TONE: Record<BadgeTone, { fill: ThemeColor; text: ThemeColor }> = {
  success: { fill: "tertiaryContainer", text: "onTertiaryContainer" },
  warning: { fill: "primaryContainer", text: "onPrimaryContainer" },
  danger: { fill: "errorContainer", text: "onErrorContainer" },
  neutral: { fill: "surfaceContainerHighest", text: "onSurfaceVariant" },
};

/**
 * A small status label (radius 8, label medium). Colour is never the only
 * signal: the words say it all.
 */
export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: BadgeTone;
}) {
  const theme = useTheme();
  const look = TONE[tone];
  return (
    <View style={[styles.pill, { backgroundColor: theme[look.fill] }]}>
      <ThemedText type="labelMedium" themeColor={look.text}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
});
