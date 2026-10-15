import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type BadgeTone = "success" | "warning" | "danger" | "neutral";

const TONE: Record<BadgeTone, { fill: ThemeColor; text: ThemeColor }> = {
  success: { fill: "brandSoft", text: "brand" },
  warning: { fill: "warningSoft", text: "ink" },
  danger: { fill: "dangerSoft", text: "danger" },
  neutral: { fill: "bg", text: "inkMuted" },
};

/** A small status pill. Colour is never the only signal: the label says it all. */
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
      <ThemedText type="label" themeColor={look.text}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.twoHalf,
    paddingVertical: Spacing.half,
  },
});
