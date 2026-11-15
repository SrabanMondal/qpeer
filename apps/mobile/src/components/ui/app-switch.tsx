import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { RIPPLE_ALPHA, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * A labelled switch row (B17, INC-044). The text takes the free width and
 * wraps; the switch keeps its natural size (it never shrinks into a sliver).
 * Off track and knob have clear contrast in both themes.
 */
export function AppSwitch({
  label,
  description,
  value,
  onValueChange,
  disabled,
  right,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  /** Optional extra content under the description. */
  right?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        if (!disabled) onValueChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      accessibilityHint={description}
      android_ripple={{ color: theme.onSurface, alpha: RIPPLE_ALPHA }}
      style={styles.row}
    >
      <View style={styles.text}>
        <ThemedText type="bodyLarge">{label}</ThemedText>
        {description ? (
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {description}
          </ThemedText>
        ) : null}
        {right}
      </View>
      <ThemedSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        // The row is the accessible control; avoid a second focus stop.
        accessible={false}
      />
    </Pressable>
  );
}

/**
 * The bare switch with the app's colours and a size that never shrinks. Use
 * `AppSwitch` for a labelled row; this for switches inside custom rows.
 */
export function ThemedSwitch({
  value,
  onValueChange,
  disabled,
  accessible = true,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  accessible?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.switch}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessible={accessible}
        accessibilityLabel={accessibilityLabel}
        importantForAccessibility={accessible ? "auto" : "no-hide-descendants"}
        // M3 switch colours. The off track is `outline` (not a surface
        // container) so "off" stays visible on every surface (INC-044).
        trackColor={{ true: theme.primary, false: theme.outline }}
        thumbColor={value ? theme.onPrimary : theme.surfaceContainerHighest}
        ios_backgroundColor={theme.outline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
    minHeight: 48,
  },
  text: { flex: 1, flexShrink: 1, gap: Spacing.one },
  switch: { flexShrink: 0, flexGrow: 0 },
});
