import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Icon, type IconName } from "@/components/ui/icon";
import { Radius, Spacing } from "@/constants/theme";
import { useIsDark, useTheme } from "@/hooks/use-theme";

type ListItemProps = {
  title: string;
  subtitle?: string | null;
  /** Icon on the left, in a soft blue circle. */
  icon?: IconName;
  /** Extra content under the subtitle, e.g. a badge. */
  footer?: ReactNode;
  /** Shown on the right, e.g. a value. */
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
};

/** A card-style row (min 56 dp) with a chevron when it navigates. */
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
  const dark = useIsDark();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.primarySoft : theme.card,
          borderColor: theme.border,
          borderWidth: dark ? 1 : 0,
        },
      ]}
    >
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: theme.primarySoft }]}>
          <Icon name={icon} size={22} color="primary" />
        </View>
      ) : null}
      <View style={styles.body}>
        <ThemedText type="body">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="inkMuted">
            {subtitle}
          </ThemedText>
        ) : null}
        {footer}
      </View>
      {right}
      {onPress ? <Icon name="chevron_right" color="inkMuted" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    borderRadius: Radius.card,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twoHalf,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: Spacing.one },
});
