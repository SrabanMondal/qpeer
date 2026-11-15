import { Pressable, StyleSheet, Text, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui/icon";
import {
  DISABLED_CONTENT_ALPHA,
  Radius,
  RIPPLE_ALPHA,
  Spacing,
  Type,
  withAlpha,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type Choice<T extends string> = { value: T; label: string };

/** Visible chip height (M3 filter chip); the tap area is 48. */
const CHIP_HEIGHT = 32;
const TARGET = 48;

/**
 * Single choice shown as wrapping M3 filter chips: radius 8, a check and
 * secondaryContainer when selected, an outline when not. Each chip is a
 * 48 dp tap target around the 32 dp chip.
 */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  disabled = false,
}: {
  label: string;
  options: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      <ThemedText type="labelLarge" themeColor="onSurfaceVariant">
        {label}
      </ThemedText>
      <View style={styles.row}>
        {options.map((o) => {
          const selected = o.value === value;
          const content = disabled
            ? withAlpha(theme.onSurface, DISABLED_CONTENT_ALPHA)
            : selected
              ? theme.onSecondaryContainer
              : theme.onSurfaceVariant;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={o.label}
              style={styles.target}
            >
              <View
                style={[
                  styles.chip,
                  selected
                    ? { backgroundColor: theme.secondaryContainer }
                    : { borderWidth: 1, borderColor: theme.outline },
                ]}
              >
                {/* The ripple sits on the visible chip, not the 48 dp area. */}
                <Pressable
                  onPress={() => onChange(o.value)}
                  disabled={disabled}
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                  android_ripple={{ color: content, alpha: RIPPLE_ALPHA }}
                  style={styles.inner}
                >
                  {selected ? (
                    <Icon name="check" size={18} colorValue={content} />
                  ) : null}
                  <Text style={[Type.labelLarge, { color: content }]}>
                    {o.label}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <ThemedText type="bodyMedium" themeColor="error">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  row: { flexDirection: "row", flexWrap: "wrap", columnGap: Spacing.two },
  target: { minHeight: TARGET, justifyContent: "center" },
  chip: {
    minHeight: CHIP_HEIGHT,
    borderRadius: Radius.chip,
    overflow: "hidden",
  },
  inner: {
    minHeight: CHIP_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.twoHalf,
  },
});
