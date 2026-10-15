import type { AppMode } from "@qpeer/shared";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const TRACK_W = 52;
const TRACK_H = 30;
const KNOB = 24;

/**
 * Customer ↔ Business toggle with the caption "Business / Customer" (§3,
 * business-interface.jpg). On (teal, knob right) = Business.
 * `onDark` is for the dark header band.
 */
export function ModeSwitch({
  mode,
  onChange,
  disabled = false,
  onDark = false,
}: {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
  disabled?: boolean;
  onDark?: boolean;
}) {
  const theme = useTheme();
  const on = mode === "business";
  const caption: ThemeColor = onDark ? "onPrimary" : "inkMuted";
  return (
    <Pressable
      onPress={() => onChange(on ? "customer" : "business")}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel="Business mode"
      accessibilityState={{ checked: on, disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.wrap,
        (pressed || disabled) && styles.dim,
      ]}
    >
      <View
        style={[
          styles.track,
          {
            backgroundColor: on ? theme.brand : theme.border,
            alignItems: on ? "flex-end" : "flex-start",
          },
        ]}
      >
        <View style={[styles.knob, { backgroundColor: theme.card }]} />
      </View>
      <ThemedText type="label" themeColor={caption}>
        {on ? "Business" : "Customer"}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  dim: { opacity: 0.6 },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: Radius.pill,
    padding: (TRACK_H - KNOB) / 2,
    justifyContent: "center",
  },
  knob: { width: KNOB, height: KNOB, borderRadius: Radius.pill },
});
