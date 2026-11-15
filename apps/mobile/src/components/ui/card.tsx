import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

import { Radius, Spacing, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * A tonal card (§3): a surface container fill, radius 16, padding 16, no
 * shadow and no border; depth comes from the tone. `tone` picks the
 * container step (default `surfaceContainer`). Not every group needs one:
 * use space and type first.
 */
export function Card({
  children,
  style,
  tone = "surfaceContainer",
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: ThemeColor;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme[tone] }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
});
