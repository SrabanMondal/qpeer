import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon, type IconName } from "@/components/ui/icon";
import {
  Elevation,
  Radius,
  RIPPLE_ALPHA,
  Spacing,
  Type,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * M3 extended FAB: `primaryContainer`, 56 dp tall, radius 16, a 24 dp icon
 * and a label large, elevation level 3 (it floats). Place it in an
 * absolutely positioned slot at the bottom right of a screen; it starts
 * the screen's main task ("Scan QR") without taking a row in the list.
 */
export function ExtendedFab({
  icon,
  label,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    // The shadow sits outside the ripple's clipping view.
    <View
      style={[
        styles.shadow,
        {
          backgroundColor: theme.primaryContainer,
          boxShadow: Elevation.level3,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        onPress={onPress}
        android_ripple={{
          color: theme.onPrimaryContainer,
          alpha: RIPPLE_ALPHA,
        }}
        style={styles.fab}
      >
        <Icon name={icon} color="onPrimaryContainer" />
        <Text style={[Type.labelLarge, { color: theme.onPrimaryContainer }]}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: { borderRadius: Radius.lg },
  fab: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.four - Spacing.one,
    borderRadius: Radius.lg,
    overflow: "hidden",
  },
});
