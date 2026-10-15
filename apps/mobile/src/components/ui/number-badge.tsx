import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Radius, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Large circle with the white ticket number (§3, qpeer-client-interface.jpg).
 * `color` defaults to `primary`; the ticket uses `brand` when it is called.
 */
export function NumberBadge({
  label,
  size = 168,
  color = "primary",
}: {
  label: string;
  size?: number;
  color?: ThemeColor;
}) {
  const theme = useTheme();
  // Long labels (e.g. "T12") shrink so they stay inside the circle.
  const fontSize = label.length > 3 ? 48 : 64;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Ticket number ${label}`}
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          backgroundColor: theme[color],
        },
      ]}
    >
      <ThemedText
        type="display"
        themeColor="onPrimary"
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ fontSize, lineHeight: fontSize * 1.15 }}
      >
        #{label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    paddingHorizontal: 12,
  },
});
