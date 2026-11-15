import {
  type ListedBusiness,
  type MapSort,
  markerStatus,
  summaryWait,
  waitSummary,
} from "@qpeer/shared";
import type { ReactElement, ReactNode } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Icon, OverflowMenu } from "@/components/ui";
import { Radius, RIPPLE_ALPHA, Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { categoryIcon, categoryLabel } from "@/lib/format";
import { formatDistance, useNow } from "@/lib/queue-format";
import { StatusPill } from "@/screens/discover/status-pill";

const SORTS: { value: MapSort; label: string }[] = [
  { value: "distance", label: "Distance" },
  { value: "wait", label: "Shortest wait" },
  { value: "name", label: "Name" },
];

/** List view (MAP-04): same data and filters as the map, sortable. */
export function BusinessList({
  rows,
  sort,
  onSort,
  canSortByDistance,
  onOpen,
  refreshing,
  onRefresh,
  header,
  empty,
  topInset,
  bottomPadding,
}: {
  rows: ListedBusiness[];
  sort: MapSort;
  onSort: (s: MapSort) => void;
  /** Distance sort needs the user's location. */
  canSortByDistance: boolean;
  onOpen: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** Notices above the rows (truncated, zoom hint, errors). */
  header?: ReactNode;
  /** Shown instead of rows: loading, empty or error. */
  empty: ReactElement | null;
  /** Room for the overlay above the list (top bar and chips). */
  topInset: number;
  bottomPadding: number;
}) {
  const theme = useTheme();
  const now = useNow(true, 30_000);
  const sorts = SORTS.filter(
    (s) => s.value !== "distance" || canSortByDistance,
  );
  const current = SORTS.find((s) => s.value === sort);

  return (
    <FlatList
      data={rows}
      extraData={now}
      keyExtractor={(b) => b.id}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topInset, paddingBottom: bottomPadding },
      ]}
      style={{ backgroundColor: theme.surface }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          progressViewOffset={topInset}
          colors={[theme.primary]}
          tintColor={theme.primary}
          progressBackgroundColor={theme.surfaceContainerHigh}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {/* A rare setting: one compact button with a menu of the sorts. */}
          <OverflowMenu
            accessibilityLabel="Sort"
            items={sorts.map((s) => ({
              label: s.label,
              selected: s.value === sort,
              onPress: () => onSort(s.value),
            }))}
            trigger={(open) => (
              <SortButton label={current?.label ?? ""} onPress={open} />
            )}
          />
          {header}
        </View>
      }
      ListEmptyComponent={empty}
      renderItem={({ item }) => (
        <BusinessRow
          business={item}
          onPress={() => onOpen(item.id)}
          now={now}
        />
      )}
    />
  );
}

/** "Sort: Distance ▾": a 48 dp text button that opens the sort menu. */
function SortButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Sort: ${label}. Change the order`}
      android_ripple={{ color: theme.primary, alpha: RIPPLE_ALPHA }}
      style={styles.sortButton}
    >
      <Icon name="sort" size={18} color="primary" />
      <Text style={[Type.labelLarge, { color: theme.primary }]}>
        {`Sort: ${label}`}
      </Text>
      <Icon name="arrow_drop_down" size={20} color="primary" />
    </Pressable>
  );
}

function BusinessRow({
  business: b,
  onPress,
  now,
}: {
  business: ListedBusiness;
  onPress: () => void;
  /** Server-corrected time: snapshot waits are shown as of now (B19). */
  now: number;
}) {
  const theme = useTheme();
  const status = markerStatus(b);
  const sub = [
    categoryLabel(b.category),
    b.distanceM !== null ? formatDistance(b.distanceM) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const queueLine =
    status === "closed" ? null : waitSummary(summaryWait(b), now);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${b.name}. ${sub}. ${queueLine ?? "Closed"}`}
      android_ripple={{ color: theme.onSurface, alpha: RIPPLE_ALPHA }}
      style={[styles.row, { backgroundColor: theme.surfaceContainer }]}
    >
      <View
        style={[styles.iconWrap, { backgroundColor: theme.secondaryContainer }]}
      >
        <Icon
          name={categoryIcon(b.category)}
          size={22}
          color="onSecondaryContainer"
        />
      </View>
      <View style={styles.body}>
        <ThemedText type="bodyLarge" numberOfLines={2}>
          {b.name}
        </ThemedText>
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          {sub}
        </ThemedText>
        <View style={styles.statusRow}>
          <StatusPill status={status} isOpenNow={b.isOpenNow} />
          {queueLine ? (
            <ThemedText type="bodyMedium" style={styles.flex}>
              {queueLine}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <Icon name="chevron_right" color="onSurfaceVariant" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.three, gap: Spacing.twoHalf },
  header: {
    gap: Spacing.twoHalf,
    paddingTop: Spacing.two,
    alignItems: "flex-start",
  },
  sortButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingHorizontal: Spacing.twoHalf,
    marginLeft: -Spacing.twoHalf,
    borderRadius: Radius.full,
    overflow: "hidden",
  },
  row: {
    minHeight: 72,
    borderRadius: Radius.card,
    overflow: "hidden",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.twoHalf,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: Spacing.one },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  flex: { flexShrink: 1 },
});
