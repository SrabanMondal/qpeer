import { Pressable, StyleSheet } from "react-native";

import { Icon, type IconName } from "@/components/ui/icon";
import {
  DISABLED_CONTENT_ALPHA,
  RIPPLE_ALPHA,
  type ThemeColor,
  withAlpha,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * M3 standard icon button: a 24 dp icon in a real 48 × 48 dp target (no
 * hitSlop) with a 40 dp borderless ripple. `accessibilityLabel` is
 * required: it says what the button does ("More actions for #14").
 */
export function IconButton({
  icon,
  onPress,
  onLongPress,
  accessibilityLabel,
  color = "onSurfaceVariant",
  disabled = false,
}: {
  icon: IconName;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
  color?: ThemeColor;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{
        color: theme[color],
        alpha: RIPPLE_ALPHA,
        borderless: true,
        radius: 20,
      }}
      style={styles.button}
    >
      <Icon
        name={icon}
        colorValue={
          disabled
            ? withAlpha(theme.onSurface, DISABLED_CONTENT_ALPHA)
            : theme[color]
        }
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
