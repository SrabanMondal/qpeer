import type { BusinessCategory } from "@qpeer/shared";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Icon, type IconName } from "@/components/ui";
import {
  Elevation,
  Radius,
  RIPPLE_ALPHA,
  Spacing,
  type ThemeColor,
  Type,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { CATEGORY_CHOICES } from "@/lib/format";

export type DiscoverView = "map" | "list";

/** Visible chip height (M3 filter chip); the tap area is 48. */
const CHIP_HEIGHT = 32;

/**
 * Top overlay of the Discover screen (map-interface.jpg): a floating title
 * bar with the Map ⇄ List toggle and Scan QR, then M3 filter chips (MAP-04):
 * Open now, All, Clinic, Lab, Service centre, Salon, Other. A wider gap
 * separates Open now from the categories.
 */
export function DiscoverTopBar({
  title,
  view,
  onView,
  onScan,
  category,
  onCategory,
  openNow,
  onOpenNow,
}: {
  title: string;
  view: DiscoverView;
  onView: (v: DiscoverView) => void;
  onScan: () => void;
  category: BusinessCategory | null;
  onCategory: (c: BusinessCategory | null) => void;
  openNow: boolean;
  onOpenNow: (v: boolean) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      {/* It floats over the map: a tonal surface with the level 3 shadow. */}
      <View
        style={[
          styles.bar,
          {
            backgroundColor: theme.surfaceContainerHigh,
            boxShadow: Elevation.level3,
          },
        ]}
      >
        <ThemedText
          type="titleMedium"
          numberOfLines={1}
          style={styles.title}
          accessibilityRole="header"
        >
          {title}
        </ThemedText>
        <BarButton
          icon={view === "map" ? "list" : "map"}
          label={view === "map" ? "List" : "Map"}
          accessibilityLabel={view === "map" ? "Show as list" : "Show map"}
          onPress={() => onView(view === "map" ? "list" : "map")}
          fill="secondaryContainer"
          content="onSecondaryContainer"
        />
        <BarButton
          icon="qr_code_scanner"
          label="Scan QR"
          accessibilityLabel="Scan QR to join"
          onPress={onScan}
          fill="primary"
          content="onPrimary"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        <Chip
          label="Open now"
          icon="schedule"
          selected={openNow}
          onPress={() => onOpenNow(!openNow)}
          role="switch"
        />
        <View style={styles.groupGap} />
        <Chip
          label="All"
          selected={category === null}
          onPress={() => onCategory(null)}
        />
        {CATEGORY_CHOICES.map((c) => (
          <Chip
            key={c.value}
            label={c.label}
            selected={category === c.value}
            onPress={() => onCategory(category === c.value ? null : c.value)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** A full-round button in the bar: 48 dp, icon and label, ripple. */
function BarButton({
  icon,
  label,
  accessibilityLabel,
  onPress,
  fill,
  content,
}: {
  icon: IconName;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  fill: ThemeColor;
  content: ThemeColor;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: theme[content], alpha: RIPPLE_ALPHA }}
      style={[styles.barButton, { backgroundColor: theme[fill] }]}
    >
      <Icon name={icon} size={20} color={content} />
      <Text
        style={[Type.labelLarge, { color: theme[content] }]}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * M3 filter chip over the map: a 32 dp chip inside a real 48 dp target
 * (no hitSlop), radius 8, a check and `secondaryContainer` when selected,
 * a light surface with an outline when not, so it reads on any map.
 */
function Chip({
  label,
  icon,
  selected,
  onPress,
  role = "radio",
}: {
  label: string;
  icon?: IconName;
  selected: boolean;
  onPress: () => void;
  role?: "radio" | "switch";
}) {
  const theme = useTheme();
  const content = selected ? "onSecondaryContainer" : "onSurfaceVariant";
  const leading: IconName | undefined = selected ? "check" : icon;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={
        role === "switch" ? { checked: selected } : { selected }
      }
      accessibilityLabel={label}
      style={styles.target}
    >
      <View
        style={[
          styles.chip,
          selected
            ? { backgroundColor: theme.secondaryContainer }
            : {
                backgroundColor: theme.surfaceContainerLow,
                borderWidth: 1,
                borderColor: theme.outline,
              },
        ]}
      >
        {/* The ripple sits on the visible chip, not the 48 dp area. */}
        <Pressable
          onPress={onPress}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          android_ripple={{ color: theme[content], alpha: RIPPLE_ALPHA }}
          style={styles.chipInner}
        >
          {leading ? <Icon name={leading} size={18} color={content} /> : null}
          <Text
            style={[Type.labelLarge, { color: theme[content] }]}
            maxFontSizeMultiplier={1.3}
          >
            {label}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: Radius.xl,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    paddingVertical: Spacing.one,
    minHeight: 56,
  },
  title: { flex: 1 },
  barButton: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.full,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
  },
  chips: {
    columnGap: Spacing.two,
    alignItems: "center",
    paddingRight: Spacing.three,
  },
  groupGap: { width: Spacing.two },
  target: { minHeight: 48, justifyContent: "center" },
  chip: {
    minHeight: CHIP_HEIGHT,
    borderRadius: Radius.chip,
    overflow: "hidden",
  },
  chipInner: {
    minHeight: CHIP_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.twoHalf,
  },
});
