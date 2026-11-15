import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import { Icon, type IconName } from "@/components/ui/icon";
import {
  DISABLED_CONTAINER_ALPHA,
  DISABLED_CONTENT_ALPHA,
  Radius,
  RIPPLE_ALPHA,
  Spacing,
  type ThemeColor,
  Type,
  withAlpha,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { OFFLINE_ACTION_TEXT, useOffline } from "@/lib/network";

/**
 * Material 3 buttons (design guide §3), all full-round:
 * - `filled`: primary / onPrimary. The screen's one main action.
 * - `tonal`: secondaryContainer. A second action beside it.
 * - `outlined`: outline border, primary text.
 * - `text`: primary text only. Low emphasis.
 * - `danger`: a text button in `error` ("Leave queue").
 * - `danger-tonal`: errorContainer fill, for a destructive action in a row
 *   of tonal ones ("No-show").
 *
 * Old names still work: `primary` and `brand` = filled, `secondary` =
 * tonal, `outline` = outlined, `danger-soft` = danger-tonal.
 */
export type ButtonVariant =
  | "filled"
  | "tonal"
  | "outlined"
  | "text"
  | "danger"
  | "danger-tonal"
  /** @deprecated use `filled`. */
  | "primary"
  /** @deprecated use `filled`. */
  | "brand"
  /** @deprecated use `tonal`. */
  | "secondary"
  /** @deprecated use `outlined`. */
  | "outline"
  /** @deprecated use `danger-tonal`. */
  | "danger-soft";

type Look = {
  fill: ThemeColor | null;
  content: ThemeColor;
  border?: ThemeColor;
};

const LOOK: Record<ButtonVariant, Look> = {
  filled: { fill: "primary", content: "onPrimary" },
  tonal: { fill: "secondaryContainer", content: "onSecondaryContainer" },
  outlined: { fill: null, content: "primary", border: "outline" },
  text: { fill: null, content: "primary" },
  danger: { fill: null, content: "error" },
  "danger-tonal": { fill: "errorContainer", content: "onErrorContainer" },
  primary: { fill: "primary", content: "onPrimary" },
  brand: { fill: "primary", content: "onPrimary" },
  secondary: { fill: "secondaryContainer", content: "onSecondaryContainer" },
  outline: { fill: null, content: "primary", border: "outline" },
  "danger-soft": { fill: "errorContainer", content: "onErrorContainer" },
};

/**
 * Heights: `medium` 48 (every button keeps a 48 dp target), `large` 56 for a
 * screen's primary action, `hero` 72 for NEXT.
 */
export type ButtonSize = "medium" | "large" | "hero";

const HEIGHT: Record<ButtonSize, number> = { medium: 48, large: 56, hero: 72 };
const ICON: Record<ButtonSize, number> = { medium: 18, large: 24, hero: 28 };
const LABEL: Record<ButtonSize, TextStyle> = {
  medium: Type.labelLarge,
  large: Type.titleMedium,
  hero: Type.nextLabel,
};

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  disabled?: boolean;
  /** Busy: a spinner on the button itself, which ignores taps meanwhile. */
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

/** A full-round Material 3 button with ripple, busy and disabled states. */
export function Button({
  title,
  onPress,
  variant = "filled",
  size = "medium",
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
  const off = disabled || blocked;
  const inactive = off || loading;
  const label = blocked ? `${title} (offline)` : title;

  // M3 disabled: container onSurface 10 %, content onSurface 38 %.
  const content = off
    ? withAlpha(theme.onSurface, DISABLED_CONTENT_ALPHA)
    : theme[look.content];
  const fill = look.fill
    ? off
      ? withAlpha(theme.onSurface, DISABLED_CONTAINER_ALPHA)
      : theme[look.fill]
    : "transparent";
  const border = look.border
    ? off
      ? withAlpha(theme.onSurface, DISABLED_CONTAINER_ALPHA)
      : theme[look.border]
    : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={blocked ? OFFLINE_ACTION_TEXT : undefined}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      android_ripple={{ color: theme[look.content], alpha: RIPPLE_ALPHA }}
      style={[
        styles.base,
        {
          minHeight: HEIGHT[size],
          backgroundColor: fill,
          paddingHorizontal:
            look.fill || look.border ? Spacing.four : Spacing.twoHalf,
        },
        border ? { borderWidth: 1, borderColor: border } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={content} />
      ) : icon ? (
        <Icon name={icon} size={ICON[size]} colorValue={content} />
      ) : null}
      <View style={styles.labelWrap}>
        <Text style={[LABEL[size], styles.label, { color: content }]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.full,
    // Keeps the ripple inside the round corners.
    overflow: "hidden",
    paddingVertical: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
  },
  labelWrap: { flexShrink: 1 },
  label: { textAlign: "center" },
});
