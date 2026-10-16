import type { BusinessCategory } from "@qpeer/shared";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Icon, type IconName } from "@/components/ui";
import { Radius, Spacing, Type } from "@/constants/theme";
import { useIsDark, useTheme } from "@/hooks/use-theme";
import { CATEGORY_CHOICES } from "@/lib/format";

export type DiscoverView = "map" | "list";

const CHIP_HIT = { top: 4, bottom: 4, left: 2, right: 2 };

/**
 * Top overlay of the Discover screen (map-interface.jpg): title bar with the
 * Map ⇄ List toggle and Scan QR, then filter chips (MAP-04): Open now,
 * All, Clinic, Lab, Service centre, Salon, Other.
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
  const dark = useIsDark();
  const surface = {
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: dark ? 1 : 0,
  };

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.bar,
          surface,
          !dark && styles.shadow,
          !dark && { shadowColor: theme.shadow },
        ]}
      >
        <Icon name="search" size={22} color="inkMuted" />
        <ThemedText
          type="body"
          themeColor="inkMuted"
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
        />
        <BarButton
          icon="qr_code_scanner"
          label="Scan QR"
          accessibilityLabel="Scan QR to join"
          onPress={onScan}
          brand
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
          icon={openNow ? "check" : "schedule"}
          selected={openNow}
          onPress={() => onOpenNow(!openNow)}
          role="switch"
        />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
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

function BarButton({
  icon,
  label,
  accessibilityLabel,
  onPress,
  brand = false,
}: {
  icon: IconName;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  brand?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.barButton,
        { backgroundColor: brand ? theme.brand : theme.primarySoft },
        pressed && styles.dim,
      ]}
    >
      <Icon name={icon} size={20} color={brand ? "onPrimary" : "ink"} />
      <Text
        style={[
          styles.barButtonText,
          { color: brand ? theme.onPrimary : theme.ink },
        ]}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
    </Pressable>
  );
}

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
  return (
    <Pressable
      onPress={onPress}
      hitSlop={CHIP_HIT}
      accessibilityRole={role}
      accessibilityState={
        role === "switch" ? { checked: selected } : { selected }
      }
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.primary : theme.card,
          borderColor: selected ? theme.primary : theme.border,
        },
        pressed && styles.dim,
      ]}
    >
      {icon ? (
        <Icon name={icon} size={18} color={selected ? "onPrimary" : "ink"} />
      ) : null}
      <Text
        style={[
          styles.chipText,
          { color: selected ? theme.onPrimary : theme.ink },
        ]}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: Radius.card,
    paddingLeft: Spacing.twoHalf,
    paddingRight: Spacing.one,
    paddingVertical: Spacing.one,
    minHeight: 56,
  },
  shadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  title: { flex: 1 },
  barButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: Spacing.twoHalf,
    borderRadius: Radius.button,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
  },
  barButtonText: { ...Type.label },
  chips: {
    gap: Spacing.two,
    alignItems: "center",
    paddingRight: Spacing.three,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: Spacing.twoHalf,
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    elevation: 2,
  },
  chipText: { ...Type.small, fontWeight: "600" },
  divider: { width: 1, height: 24 },
  dim: { opacity: 0.6 },
});
