import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Icon } from "@/components/ui/icon";
import { Radius, RIPPLE_ALPHA, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * A group that starts collapsed: a header row (the section title in title
 * small `primary`, its current values in one line under it, and an expand
 * chevron) that opens and closes the content on tap. For rare settings
 * and for lists most visits don't need ("Archived (3)"). The whole header
 * is one 56 dp target with a ripple.
 */
export function ExpandableSection({
  title,
  summary,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  /** The current values in one line, shown while collapsed and open. */
  summary?: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={summary ? `${title}: ${summary}` : title}
        accessibilityHint={expanded ? "Collapses the section" : "Expands it"}
        android_ripple={{ color: theme.onSurface, alpha: RIPPLE_ALPHA }}
        style={styles.header}
      >
        <View style={styles.text}>
          <ThemedText type="titleSmall" themeColor="primary">
            {title}
          </ThemedText>
          {summary ? (
            <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
              {summary}
            </ThemedText>
          ) : null}
        </View>
        <Icon
          name={expanded ? "expand_less" : "expand_more"}
          color="onSurfaceVariant"
        />
      </Pressable>
      {expanded ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two, marginTop: Spacing.one },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    minHeight: 56,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    marginHorizontal: -Spacing.two,
    borderRadius: Radius.md,
    overflow: "hidden",
  },
  text: { flex: 1, gap: Spacing.half },
});
