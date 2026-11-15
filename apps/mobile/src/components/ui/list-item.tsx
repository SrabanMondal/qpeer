import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Icon, type IconName } from "@/components/ui/icon";
import { Radius, RIPPLE_ALPHA, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type ListItemProps = {
  title: string;
  subtitle?: string | null;
  /** Leading icon, in a secondaryContainer circle. */
  icon?: IconName;
  /** Extra content under the subtitle, e.g. a badge. */
  footer?: ReactNode;
  /** Shown on the right, e.g. a value. */
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
};

/**
 * An M3 list item on a tonal row (min 56 dp, radius 16): title body large,
 * supporting text body medium, a ripple and a chevron when it navigates.
 */
export function ListItem({
  title,
  subtitle,
  icon,
  footer,
  right,
  onPress,
  accessibilityLabel,
}: ListItemProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      android_ripple={
        onPress ? { color: theme.onSurface, alpha: RIPPLE_ALPHA } : undefined
      }
      style={[styles.row, { backgroundColor: theme.surfaceContainer }]}
    >
      {icon ? (
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: theme.secondaryContainer },
          ]}
        >
          <Icon name={icon} size={22} color="onSecondaryContainer" />
        </View>
      ) : null}
      <View style={styles.body}>
        <ThemedText type="bodyLarge">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {subtitle}
          </ThemedText>
        ) : null}
        {footer}
      </View>
      {right}
      {onPress ? <Icon name="chevron_right" color="onSurfaceVariant" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    borderRadius: Radius.card,
    overflow: "hidden",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twoHalf,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: Spacing.half },
});
