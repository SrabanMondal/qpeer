import type { AppMode } from "@qpeer/shared";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  DISABLED_CONTENT_ALPHA,
  Radius,
  RIPPLE_ALPHA,
  Spacing,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const TRACK_W = 52;
const TRACK_H = 32;
const KNOB_ON = 24;
const KNOB_OFF = 16;

/**
 * Customer ↔ Business toggle with the caption "Business / Customer" (§3).
 * Drawn like an M3 switch: on = `primary` track, knob right (Business);
 * off = outlined track with a small `outline` knob. The whole control is a
 * 48 dp target with a ripple (no hitSlop).
 *
 * `onDark` (the name is historical: the header band is no longer dark) is
 * the compact form for the top app bar: the caption grows only a little
 * with large fonts, so it fits next to the title on a 360 dp screen (B3).
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
  const knob = on ? KNOB_ON : KNOB_OFF;
  return (
    <Pressable
      onPress={() => onChange(on ? "customer" : "business")}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel="Business mode"
      accessibilityState={{ checked: on, disabled }}
      android_ripple={{ color: theme.onSurface, alpha: RIPPLE_ALPHA }}
      style={[styles.wrap, disabled && { opacity: DISABLED_CONTENT_ALPHA }]}
    >
      <View
        style={[
          styles.track,
          on
            ? { backgroundColor: theme.primary, borderColor: theme.primary }
            : {
                backgroundColor: theme.surfaceContainerHighest,
                borderColor: theme.outline,
              },
          { alignItems: on ? "flex-end" : "flex-start" },
        ]}
      >
        <View
          style={[
            styles.knob,
            {
              width: knob,
              height: knob,
              marginHorizontal: on ? 2 : 6,
              backgroundColor: on ? theme.onPrimary : theme.outline,
            },
          ]}
        />
      </View>
      <ThemedText
        type="labelLarge"
        themeColor="onSurfaceVariant"
        numberOfLines={1}
        maxFontSizeMultiplier={onDark ? 1.2 : undefined}
      >
        {on ? "Business" : "Customer"}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.full,
    overflow: "hidden",
  },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: Radius.full,
    borderWidth: 2,
    justifyContent: "center",
  },
  knob: { borderRadius: Radius.full },
});
