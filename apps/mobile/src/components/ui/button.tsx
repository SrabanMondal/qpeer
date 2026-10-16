import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";

import { Icon, type IconName } from "@/components/ui/icon";
import { Radius, Spacing, type ThemeColor, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { OFFLINE_ACTION_TEXT, useOffline } from "@/lib/network";

/**
 * Design guide §3:
 * - `primary`: solid blue, operational main action.
 * - `brand`: solid teal, customer/brand action.
 * - `secondary`: soft blue fill, ink text.
 * - `outline`: card fill with a border, ink text.
 * - `danger-soft`: soft red fill, red text (destructive actions).
 */
export type ButtonVariant =
  | "primary"
  | "brand"
  | "secondary"
  | "outline"
  | "danger-soft";

const LOOK: Record<
  ButtonVariant,
  { fill: ThemeColor; text: ThemeColor; border?: ThemeColor }
> = {
  primary: { fill: "primary", text: "onPrimary" },
  brand: { fill: "brand", text: "onPrimary" },
  secondary: { fill: "primarySoft", text: "ink" },
  outline: { fill: "card", text: "ink", border: "border" },
  "danger-soft": { fill: "dangerSoft", text: "danger" },
};

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  /** Spoken label when the title alone is not clear enough. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * B13: the action needs the server. While offline the button is disabled
   * and says why (title "… (offline)", spoken hint `OFFLINE_ACTION_TEXT`).
   */
  needsNetwork?: boolean;
};

/** Pill-cornered button, 52 dp tall (touch target ≥ 44 dp, NFR-15). */
export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  disabled = false,
  loading = false,
  accessibilityLabel,
  style,
  needsNetwork = false,
}: ButtonProps) {
  const theme = useTheme();
  const look = LOOK[variant];
  const offline = useOffline();
  const blocked = needsNetwork && offline;
  const inactive = disabled || loading || blocked;
  const label = blocked ? `${title} (offline)` : title;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={blocked ? OFFLINE_ACTION_TEXT : undefined}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: theme[look.fill] },
        look.border && {
          borderWidth: 1,
          borderColor: theme[look.border],
        },
        (pressed || inactive) && styles.dim,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme[look.text]} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={look.text} /> : null}
          <Text style={[styles.text, { color: theme[look.text] }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  dim: { opacity: 0.6 },
  text: { ...Type.body, fontWeight: "700", textAlign: "center" },
});
