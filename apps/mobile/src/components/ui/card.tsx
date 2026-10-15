import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

import { Radius, Spacing } from "@/constants/theme";
import { useIsDark, useTheme } from "@/hooks/use-theme";

/** White rounded card (§3): radius 16, padding 16, soft shadow; a border in dark mode. */
export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const dark = useIsDark();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.card },
        dark
          ? { borderWidth: 1, borderColor: theme.border }
          : { ...styles.shadow, shadowColor: theme.shadow },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  shadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
});
