import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useIsDark, useTheme } from "@/hooks/use-theme";

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
  return (
    <Pressable
      onPress={() => {
        if (!disabled) onValueChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label}
      accessibilityHint={description}
      style={styles.row}
    >
      <View style={styles.text}>
        <ThemedText type="body">{label}</ThemedText>
        {description ? (
          <ThemedText type="small" themeColor="inkMuted">
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
  const dark = useIsDark();
  return (
    <View style={styles.switch}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessible={accessible}
        accessibilityLabel={accessibilityLabel}
        importantForAccessibility={accessible ? "auto" : "no-hide-descendants"}
        // The old off track (`border`) was almost the card colour in dark
        // mode; `inkMuted` reads as "off" in both themes.
        trackColor={{ true: theme.brand, false: theme.inkMuted }}
        thumbColor={value ? theme.onPrimary : dark ? theme.ink : theme.card}
        ios_backgroundColor={theme.inkMuted}
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
