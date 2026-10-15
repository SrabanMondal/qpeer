import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Icon, type IconName } from "@/components/ui/icon";
import { Radius, Spacing, type ThemeColor } from "@/constants/theme";
import { useIsDark, useTheme } from "@/hooks/use-theme";
import { hideToast, type ToastTone, useToast } from "@/lib/toast";

const LOOK: Record<ToastTone, { icon: IconName; color: ThemeColor }> = {
  info: { icon: "notifications_active", color: "primary" },
  success: { icon: "check_circle", color: "brand" },
  warning: { icon: "hourglass_top", color: "warning" },
  danger: { icon: "error", color: "danger" },
};

/**
 * Renders the current toast (`lib/toast.ts`) over every screen, under the
 * status bar. Tap runs its action (if any) and hides it; it also hides itself.
 */
export function ToastHost() {
  const toast = useToast();
  const theme = useTheme();
  const dark = useIsDark();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  const look = LOOK[toast.tone];

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + Spacing.two }]}
    >
      <Pressable
        accessibilityRole={toast.onPress ? "button" : "alert"}
        accessibilityLiveRegion="polite"
        accessibilityHint={toast.onPress ? "Opens the details" : "Dismisses"}
        onPress={() => {
          hideToast(toast.id);
          toast.onPress?.();
        }}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: theme.card,
            borderColor: theme[look.color],
            shadowColor: theme.shadow,
          },
          !dark && styles.shadow,
          pressed && styles.pressed,
        ]}
      >
        <Icon name={look.icon} color={look.color} />
        <View style={styles.text}>
          <ThemedText type="body" style={styles.title}>
            {toast.title}
          </ThemedText>
          {toast.message ? (
            <ThemedText type="small" themeColor="inkMuted" selectable>
              {toast.message}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: Spacing.three,
    right: Spacing.three,
    zIndex: 1000,
    elevation: 10,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
    padding: Spacing.three,
    borderRadius: Radius.card,
    borderLeftWidth: 6,
    minHeight: 56,
  },
  shadow: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  pressed: { opacity: 0.8 },
  text: { flex: 1, gap: Spacing.half },
  title: { fontWeight: "700" },
});
