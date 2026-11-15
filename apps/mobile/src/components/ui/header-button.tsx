import { Pressable, StyleSheet, Text } from "react-native";
import {
  DISABLED_CONTENT_ALPHA,
  Radius,
  RIPPLE_ALPHA,
  Spacing,
  type ThemeColor,
  Type,
  withAlpha,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * A small M3 text button (headers, inline actions): label large, a real
 * 48 × 48 dp target (no hitSlop), a ripple inside its full-round shape.
 */
export function HeaderButton({
  title,
  onPress,
  accessibilityLabel,
  color = "primary",
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  accessibilityLabel?: string;
  color?: ThemeColor;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const content = disabled
    ? withAlpha(theme.onSurface, DISABLED_CONTENT_ALPHA)
    : theme[color];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      android_ripple={{ color: theme[color], alpha: RIPPLE_ALPHA }}
      style={styles.button}
    >
      <Text style={[Type.labelLarge, { color: content }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: Spacing.twoHalf,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.full,
    overflow: "hidden",
  },
});
