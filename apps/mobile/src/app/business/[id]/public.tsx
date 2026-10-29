import {
  type OpenLook,
  openLook,
  type QueueView,
  statsSummary,
  waitSummary,
} from "@qpeer/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { PriorityChip } from "@/components/priority-chip";
import { ThemedText } from "@/components/themed-text";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  Screen,
  SectionHeader,
  StatusBanner,
  type StatusTone,
} from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useBusiness } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { openDirections } from "@/lib/directions";
import { categoryIcon, categoryLabel, formatRupees } from "@/lib/format";
import { payHref } from "@/lib/pay-flow";
import { useNow } from "@/lib/queue-format";

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
  const now = useNow(true, 30_000);
  const { user } = useAuth();
  const guest = !user || user.isAnonymous;

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
  // B16: the queues decide (same rule as the map badge), the hours inform.
  const open = queues.filter((q) => q.live && q.live.status !== "closed");
  const bizStatus =
    open.length === 0
      ? "closed"
      : open.every((q) => q.live?.status === "paused")
        ? "paused"
        : "open";
  const bizLook = openLook(bizStatus, b.isOpenNow);
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
        tone={TONE_BANNER[bizLook.tone]}
        title={bizLook.label}
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
            withinHours={b.isOpenNow}
            now={now}
            guest={guest}
            onJoin={() =>
              router.push({ pathname: "/q/[id]", params: { id: q.id } })
            }
            onReserve={() =>
              router.push(payHref({ kind: "reservation", queueId: q.id }))
            }
            onPriority={() =>
              router.push(
                guest
                  ? "/sign-in"
                  : payHref({ kind: "priority", queueId: q.id }),
              )
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

      <SectionHeader title="How to get a place" />
      <Card>
        <ThemedText type="body">
          Walk in: go to the business and tap Join on a queue above, or scan the
          QR code at the counter. Qpeer checks once that you are there. Free.
        </ThemedText>
        <ThemedText type="body">
          Reserve from home: hold a place for a small fee while the queue is
          open, and come when we alert you. You see the fee and the refund rules
          before you pay.
        </ThemedText>
        {guest ? (
          <ThemedText type="small" themeColor="inkMuted">
            Reserving and Priority Passes need a phone or Google sign-in.
          </ThemedText>
        ) : null}
      </Card>
    </Screen>
  );
}

const TONE_BANNER: Record<OpenLook["tone"], StatusTone> = {
  success: "active",
  warning: "paused",
  neutral: "closed",
};

function QueueCard({
  queue: q,
  withinHours,
  now,
  guest,
  onJoin,
  onReserve,
  onPriority,
}: {
  queue: QueueView;
  withinHours: boolean;
  now: number;
  guest: boolean;
  onJoin: () => void;
  onReserve: () => void;
  onPriority: () => void;
}) {
  const live = q.live ?? null;
  const look = openLook(live?.status ?? "closed", withinHours);
  const open = live?.status === "open";
  const priority = q.priority?.enabled ? q.priority : null;
  const soldOut = live?.priority?.soldOut === true;
  return (
    <Card>
      <View style={styles.queueTop}>
        <ThemedText type="heading" style={styles.flex}>
          {q.name}
        </ThemedText>
        <Badge label={look.label} tone={look.tone} />
      </View>
      <PriorityChip priority={q.priority} />
      <ThemedText type="body">
        {live && live.status !== "closed"
          ? waitSummary(live, now)
          : "Not taking people right now"}
      </ThemedText>
      <Button
        title={open ? "Join" : "View queue"}
        variant={open ? "brand" : "outline"}
        icon={open ? "how_to_reg" : "info"}
        onPress={onJoin}
        accessibilityLabel={`${open ? "Join" : "View"} ${q.name}`}
      />
      {open ? (
        <Button
          title="Reserve from home"
          variant="secondary"
          icon="event_available"
          onPress={onReserve}
          accessibilityLabel={`Reserve a place in ${q.name} from home`}
          needsNetwork
        />
      ) : null}
      {priority ? (
        soldOut ? (
          <Button
            title="Priority Pass · sold out today"
            variant="outline"
            icon="block"
            disabled
            onPress={() => undefined}
          />
        ) : (
          <Button
            title={
              guest
                ? "Sign in to buy a Priority Pass"
                : `Buy Priority Pass · ${formatRupees(priority.feePaise)}`
            }
            variant="outline"
            icon="bolt"
            onPress={onPriority}
            needsNetwork
          />
        )
      ) : null}
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
