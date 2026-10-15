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
 * `onDark` is for the dark header band: a compact outlined pill with a
 * smaller track whose caption grows only a little with large fonts, so it
 * fits next to the header title on a 360 dp screen (B3).
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
        onDark && [styles.pill, { borderColor: theme.inkMuted }],
        (pressed || disabled) && styles.dim,
      ]}
    >
      <View
        style={[
          styles.track,
          onDark && styles.trackSmall,
          {
            backgroundColor: on ? theme.brand : theme.border,
            alignItems: on ? "flex-end" : "flex-start",
          },
        ]}
      >
        <View
          style={[
            styles.knob,
            onDark && styles.knobSmall,
            { backgroundColor: theme.card },
          ]}
        />
      </View>
      <ThemedText
        type="label"
        themeColor={caption}
        numberOfLines={1}
        maxFontSizeMultiplier={onDark ? 1.2 : undefined}
      >
        {on ? "Business" : "Customer"}
      </ThemedText>
    </Pressable>
  );
}

const SMALL_TRACK_W = 36;
const SMALL_TRACK_H = 22;
const SMALL_KNOB = 18;

const styles = StyleSheet.create({
  wrap: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  pill: {
    minHeight: 36,
    gap: Spacing.one,
    paddingLeft: Spacing.one,
    paddingRight: Spacing.twoHalf,
    borderWidth: 1,
    borderRadius: Radius.pill,
  },
  dim: { opacity: 0.6 },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: Radius.pill,
    padding: (TRACK_H - KNOB) / 2,
    justifyContent: "center",
  },
  trackSmall: {
    width: SMALL_TRACK_W,
    height: SMALL_TRACK_H,
    padding: (SMALL_TRACK_H - SMALL_KNOB) / 2,
  },
  knob: { width: KNOB, height: KNOB, borderRadius: Radius.pill },
  knobSmall: { width: SMALL_KNOB, height: SMALL_KNOB },
});
