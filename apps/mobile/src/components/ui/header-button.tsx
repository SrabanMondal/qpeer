import { Pressable, StyleSheet, Text } from "react-native";
import { Spacing, type ThemeColor, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** A small text button (headers, inline actions), 44 dp touch target. */
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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <Text style={[styles.text, { color: theme[color] }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: Spacing.two,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
  text: { ...Type.body, fontWeight: "700" },
});
