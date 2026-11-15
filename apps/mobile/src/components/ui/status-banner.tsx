import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Icon, type IconName } from "@/components/ui/icon";
import { Radius, Spacing, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type StatusTone = "active" | "paused" | "closed";

/** Container role, its on-colour, and an icon so colour is never the only cue. */
const TONE: Record<
  StatusTone,
  { fill: ThemeColor; on: ThemeColor; icon: IconName }
> = {
  active: {
    fill: "tertiaryContainer",
    on: "onTertiaryContainer",
    icon: "check_circle",
  },
  paused: {
    fill: "primaryContainer",
    on: "onPrimaryContainer",
    icon: "pause_circle",
  },
  closed: {
    fill: "surfaceContainerHighest",
    on: "onSurfaceVariant",
    icon: "do_not_disturb_on",
  },
};

/**
 * Status strip (§3): a tonal container with an icon, a title and a detail
 * line. Green (tertiary) = active, amber (primary container) = paused or
 * needs attention, grey = off/closed.
 */
export function StatusBanner({
  tone,
  title,
  detail,
  right,
}: {
  tone: StatusTone;
  title: string;
  detail?: string;
  right?: ReactNode;
}) {
  const theme = useTheme();
  const look = TONE[tone];
  return (
    <View
      style={[styles.banner, { backgroundColor: theme[look.fill] }]}
      accessibilityRole="summary"
    >
      <Icon name={look.icon} size={24} color={look.on} />
      <View style={styles.text}>
        <ThemedText type="titleMedium" themeColor={look.on}>
          {title}
        </ThemedText>
        {detail ? (
          <ThemedText type="bodyMedium" themeColor={look.on}>
            {detail}
          </ThemedText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
    paddingVertical: Spacing.twoHalf,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.card,
  },
  text: { flex: 1, gap: Spacing.half },
});
