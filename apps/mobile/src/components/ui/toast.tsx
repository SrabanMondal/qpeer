import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Icon, type IconName } from "@/components/ui/icon";
import {
  Elevation,
  Radius,
  RIPPLE_ALPHA,
  Spacing,
  type ThemeColor,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { hideToast, type ToastTone, useToast } from "@/lib/toast";

/** The icon names the tone; colours stay legible on `inverseSurface`. */
const LOOK: Record<ToastTone, { icon: IconName; color: ThemeColor }> = {
  info: { icon: "notifications_active", color: "inversePrimary" },
  success: { icon: "check_circle", color: "inversePrimary" },
  warning: { icon: "hourglass_top", color: "inversePrimary" },
  danger: { icon: "error", color: "errorContainer" },
};

/**
 * Renders the current toast (`lib/toast.ts`) over every screen, under the
 * status bar, as an M3 snackbar: `inverseSurface`, radius 4, elevation
 * level 3 (it floats). Tap runs its action (if any) and hides it; it also
 * hides itself.
 */
export function ToastHost() {
  const toast = useToast();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  const look = LOOK[toast.tone];

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + Spacing.two }]}
    >
      {/* The shadow sits outside the ripple's clipping view. */}
      <View
        style={[
          styles.shadow,
          {
            backgroundColor: theme.inverseSurface,
            boxShadow: Elevation.level3,
          },
        ]}
      >
        <Pressable
          accessibilityRole={toast.onPress ? "button" : "alert"}
          accessibilityLiveRegion="polite"
          accessibilityHint={toast.onPress ? "Opens the details" : "Dismisses"}
          onPress={() => {
            hideToast(toast.id);
            toast.onPress?.();
          }}
          android_ripple={{
            color: theme.inverseOnSurface,
            alpha: RIPPLE_ALPHA,
          }}
          style={styles.card}
        >
          <Icon name={look.icon} color={look.color} />
          <View style={styles.text}>
            <ThemedText type="titleSmall" themeColor="inverseOnSurface">
              {toast.title}
            </ThemedText>
            {toast.message ? (
              <ThemedText
                type="bodyMedium"
                themeColor="inverseOnSurface"
                selectable
              >
                {toast.message}
              </ThemedText>
            ) : null}
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: Spacing.three,
    right: Spacing.three,
    zIndex: 1000,
    // Draw order above native views such as the map (no background, so no
    // shadow is drawn from this).
    elevation: 10,
  },
  shadow: { borderRadius: Radius.xs },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
    paddingVertical: Spacing.twoHalf,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.xs,
    overflow: "hidden",
    minHeight: 48,
  },
  text: { flex: 1, gap: Spacing.half },
});
