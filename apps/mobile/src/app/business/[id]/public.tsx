import { type QueueView, statsSummary } from "@qpeer/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Screen,
  SectionHeader,
  StatusBanner,
} from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useBusiness } from "@/lib/api";
import { openDirections } from "@/lib/directions";
import { categoryIcon, categoryLabel } from "@/lib/format";
import { formatWaitRange } from "@/lib/queue-format";

/**
 * Public business page (MAP-05), opened from the map card or the list:
 * hours, queues with live waits and Join, public stats, directions.
 * Owner screens live at `business/[id]` (index); this is the customer view.
 */
export default function PublicBusinessScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const business = useBusiness(id ?? "");

  if (!business.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Business" }} />
        {business.isError ? (
          <ErrorState
            title="Could not load this business"
            error={business.error}
            onRetry={() => void business.refetch()}
            retrying={business.isFetching}
          />
        ) : (
          <LoadingState />
        )}
      </Screen>
    );
  }

  const b = business.data;
  const queues = b.queues.filter((q) => q.status === "active");
  const stats = b.stats ?? null;
  const summary = stats ? statsSummary(stats) : null;

  return (
    <Screen
      refreshing={business.isRefetching}
      onRefresh={() => {
        void business.refetch();
      }}
    >
      <Stack.Screen options={{ title: b.name }} />

      <Card>
        <View style={styles.headerRow}>
          <View style={[styles.iconWrap, { backgroundColor: theme.brandSoft }]}>
            <Icon name={categoryIcon(b.category)} size={26} color="brand" />
          </View>
          <View style={styles.flex}>
            <ThemedText type="label" themeColor="inkMuted">
              {categoryLabel(b.category).toUpperCase()}
            </ThemedText>
            <ThemedText type="title">{b.name}</ThemedText>
          </View>
        </View>
        {b.address ? (
          <ThemedText type="body" themeColor="inkMuted">
            {b.address}
          </ThemedText>
        ) : null}
        {b.location ? (
          <Button
            title="Directions"
            variant="outline"
            icon="directions"
            onPress={() => {
              if (b.location) {
                openDirections(b.location.lat, b.location.lng, b.name);
              }
            }}
            accessibilityLabel={`Directions to ${b.name}`}
          />
        ) : null}
      </Card>

      <StatusBanner
        tone={b.isOpenNow ? "active" : "closed"}
        title={b.isOpenNow ? "Open now" : "Closed now"}
        detail={`Today: ${b.todayHours.text}`}
      />

      <SectionHeader title={`Queues · ${queues.length}`} />
      {queues.length === 0 ? (
        <EmptyState
          icon="queue"
          title="No queues right now"
          message="This business has no active queue. Check again later."
        />
      ) : (
        queues.map((q) => (
          <QueueCard
            key={q.id}
            queue={q}
            onJoin={() =>
              router.push({ pathname: "/q/[id]", params: { id: q.id } })
            }
          />
        ))
      )}

      <SectionHeader title="Last 4 weeks" />
      <Card>
        {stats && summary && summary.parts.length > 0 ? (
          <>
            <ThemedText type="heading">{summary.parts.join(" · ")}</ThemedText>
            <ThemedText type="small" themeColor="inkMuted">
              {summary.basis.charAt(0).toUpperCase() + summary.basis.slice(1)}.
            </ThemedText>
          </>
        ) : (
          <>
            <ThemedText type="heading">Not enough data yet</ThemedText>
            <ThemedText type="small" themeColor="inkMuted">
              {summary
                ? `Averages show after more visits (${summary.basis}).`
                : "Average wait and service times show once this business has been on Qpeer for a while."}
            </ThemedText>
          </>
        )}
      </Card>

      <SectionHeader title="Walk in" />
      <Card>
        <ThemedText type="body">
          Go to the business and tap Join on a queue above, or scan the QR code
          at the counter. Qpeer checks once that you are there.
        </ThemedText>
        <Button
          title="Reserve from home"
          variant="secondary"
          icon="event_available"
          onPress={() => {}}
          disabled
          accessibilityLabel="Reserve from home, coming soon"
        />
        <ThemedText type="small" themeColor="inkMuted">
          Coming soon: reserve a place before you leave home.
        </ThemedText>
      </Card>
    </Screen>
  );
}

function queueLook(q: QueueView): { label: string; tone: BadgeTone } {
  switch (q.live?.status) {
    case "open":
      return { label: "Open", tone: "success" };
    case "paused":
      return { label: "Paused", tone: "warning" };
    default:
      return { label: "Closed", tone: "neutral" };
  }
}

function QueueCard({
  queue: q,
  onJoin,
}: {
  queue: QueueView;
  onJoin: () => void;
}) {
  const look = queueLook(q);
  const live = q.live ?? null;
  const open = live?.status === "open";
  const wait =
    live && live.waitLowMs !== null && live.waitHighMs !== null
      ? formatWaitRange(live.waitLowMs, live.waitHighMs)
      : null;
  return (
    <Card>
      <View style={styles.queueTop}>
        <ThemedText type="heading" style={styles.flex}>
          {q.name}
        </ThemedText>
        <Badge label={look.label} tone={look.tone} />
      </View>
      <ThemedText type="body">
        {live && live.status !== "closed"
          ? `${live.waiting} waiting${wait ? ` · ${wait}` : ""}`
          : "Not taking people right now"}
      </ThemedText>
      <Button
        title={open ? "Join" : "View queue"}
        variant={open ? "brand" : "outline"}
        icon={open ? "how_to_reg" : "info"}
        onPress={onJoin}
        accessibilityLabel={`${open ? "Join" : "View"} ${q.name}`}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  flex: { flex: 1 },
  queueTop: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
});
