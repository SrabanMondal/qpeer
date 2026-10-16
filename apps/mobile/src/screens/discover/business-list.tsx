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
import { Icon } from "@/components/ui";
import { Radius, Spacing, Type } from "@/constants/theme";
import { useIsDark, useTheme } from "@/hooks/use-theme";
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

  return (
    <FlatList
      data={rows}
      extraData={now}
      keyExtractor={(b) => b.id}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topInset, paddingBottom: bottomPadding },
      ]}
      style={{ backgroundColor: theme.bg }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          progressViewOffset={topInset}
          colors={[theme.primary]}
          tintColor={theme.primary}
          progressBackgroundColor={theme.card}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.sortRow} accessibilityRole="radiogroup">
            <ThemedText type="label" themeColor="inkMuted">
              Sort
            </ThemedText>
            {sorts.map((s) => {
              const selected = s.value === sort;
              return (
                <Pressable
                  key={s.value}
                  onPress={() => onSort(s.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.sortChip,
                    {
                      backgroundColor: selected ? theme.primary : theme.card,
                      borderColor: selected ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.sortText,
                      { color: selected ? theme.onPrimary : theme.ink },
                    ]}
                  >
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
  const dark = useIsDark();
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
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.primarySoft : theme.card,
          borderColor: theme.border,
          borderWidth: dark ? 1 : 0,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: theme.brandSoft }]}>
        <Icon name={categoryIcon(b.category)} size={22} color="brand" />
      </View>
      <View style={styles.body}>
        <ThemedText type="body" numberOfLines={2}>
          {b.name}
        </ThemedText>
        <ThemedText type="small" themeColor="inkMuted">
          {sub}
        </ThemedText>
        <View style={styles.statusRow}>
          <StatusPill status={status} isOpenNow={b.isOpenNow} />
          {queueLine ? (
            <ThemedText type="small" style={styles.flex}>
              {queueLine}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <Icon name="chevron_right" color="inkMuted" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.three, gap: Spacing.twoHalf },
  header: { gap: Spacing.twoHalf, paddingTop: Spacing.two },
  sortRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.two,
  },
  sortChip: {
    minHeight: 44,
    paddingHorizontal: Spacing.twoHalf,
    borderRadius: Radius.pill,
    borderWidth: 1,
    justifyContent: "center",
  },
  sortText: { ...Type.small, fontWeight: "600" },
  row: {
    minHeight: 72,
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
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  flex: { flexShrink: 1 },
});
