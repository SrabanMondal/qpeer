import {
  type OpenLook,
  openLook,
  type QueueView,
  statsSummary,
  waitSummary,
} from "@qpeer/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
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
  Sheet,
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
  // The queue whose "Reserve or skip the line" sheet is (or was last) open;
  // kept while the sheet slides away.
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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
  const sheetQueue = queues.find((q) => q.id === sheetFor) ?? null;
  // With one queue its Join is the page's one action, in the pinned bar.
  const single = queues.length === 1 ? queues[0] : null;
  const singleOpen = single?.live?.status === "open";

  const join = (q: QueueView) =>
    router.push({ pathname: "/q/[id]", params: { id: q.id } });

  return (
    <Screen
      refreshing={business.isRefetching}
      onRefresh={() => {
        void business.refetch();
      }}
      bottomBar={
        single ? (
          <Button
            title={singleOpen ? "Join" : "View queue"}
            size="large"
            variant={singleOpen ? "filled" : "outlined"}
            icon={singleOpen ? "how_to_reg" : "info"}
            onPress={() => join(single)}
            accessibilityLabel={`${singleOpen ? "Join" : "View"} ${single.name}`}
          />
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: b.name }} />

      {/* The app bar has the name: here what it is, where, and today's hours. */}
      <Card>
        <View style={styles.headerRow}>
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: theme.secondaryContainer },
            ]}
          >
            <Icon
              name={categoryIcon(b.category)}
              size={24}
              color="onSecondaryContainer"
            />
          </View>
          <View style={styles.flex}>
            <ThemedText type="titleMedium">
              {categoryLabel(b.category)}
            </ThemedText>
            <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
              {`Today: ${b.todayHours.text}`}
            </ThemedText>
          </View>
        </View>
        {b.address ? (
          <ThemedText type="bodyLarge" themeColor="onSurfaceVariant">
            {b.address}
          </ThemedText>
        ) : null}
        {b.location ? (
          <Button
            title="Directions"
            variant="outlined"
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

      {/* With one queue, its badge says the same: the banner only sums up
          several. */}
      {queues.length >= 2 ? (
        <StatusBanner tone={TONE_BANNER[bizLook.tone]} title={bizLook.label} />
      ) : null}

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
            onJoin={single ? undefined : () => join(q)}
            onMore={() => {
              setSheetFor(q.id);
              setSheetOpen(true);
            }}
          />
        ))
      )}

      {stats && summary && summary.parts.length > 0 ? (
        <>
          <SectionHeader title="Last 4 weeks" />
          <Card>
            <ThemedText type="titleMedium">
              {summary.parts.join(" · ")}
            </ThemedText>
            <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
              {summary.basis.charAt(0).toUpperCase() + summary.basis.slice(1)}.
            </ThemedText>
          </Card>
        </>
      ) : null}

      <WaysSheet
        visible={sheetOpen && sheetQueue !== null}
        queue={sheetQueue}
        guest={guest}
        onClose={() => setSheetOpen(false)}
        onReserve={(q) => {
          setSheetOpen(false);
          router.push(payHref({ kind: "reservation", queueId: q.id }));
        }}
        onPriority={(q) => {
          setSheetOpen(false);
          router.push(
            guest ? "/sign-in" : payHref({ kind: "priority", queueId: q.id }),
          );
        }}
      />
    </Screen>
  );
}

const TONE_BANNER: Record<OpenLook["tone"], StatusTone> = {
  success: "active",
  warning: "paused",
  neutral: "closed",
};

/** True when a queue offers a paid way in (reserve while open, or a pass). */
function hasPaidWays(q: QueueView): boolean {
  return q.live?.status === "open" || q.priority?.enabled === true;
}

function QueueCard({
  queue: q,
  withinHours,
  now,
  onJoin,
  onMore,
}: {
  queue: QueueView;
  withinHours: boolean;
  now: number;
  /** Absent when the page's pinned bar holds this queue's Join. */
  onJoin?: () => void;
  onMore: () => void;
}) {
  const live = q.live ?? null;
  const look = openLook(live?.status ?? "closed", withinHours);
  const open = live?.status === "open";
  return (
    <Card>
      <View style={styles.queueTop}>
        <ThemedText type="titleMedium" style={styles.flex}>
          {q.name}
        </ThemedText>
        <Badge label={look.label} tone={look.tone} />
      </View>
      <PriorityChip priority={q.priority} />
      <ThemedText type="bodyLarge">
        {live && live.status !== "closed"
          ? waitSummary(live, now)
          : "Not taking people right now"}
      </ThemedText>
      {onJoin ? (
        <Button
          title={open ? "Join" : "View queue"}
          variant={open ? "filled" : "outlined"}
          icon={open ? "how_to_reg" : "info"}
          onPress={onJoin}
          accessibilityLabel={`${open ? "Join" : "View"} ${q.name}`}
        />
      ) : null}
      {hasPaidWays(q) ? (
        <Button
          title="Reserve or skip the line"
          variant="tonal"
          icon="event_available"
          onPress={onMore}
          accessibilityLabel={`Reserve or skip the line in ${q.name}`}
        />
      ) : null}
    </Card>
  );
}

/**
 * The paid ways in, one tap behind "Reserve or skip the line" (owner
 * decision 2026-11-15): Reserve from home and the Priority Pass with their
 * prices and availability, and how getting a place works.
 */
function WaysSheet({
  visible,
  queue: q,
  guest,
  onClose,
  onReserve,
  onPriority,
}: {
  visible: boolean;
  queue: QueueView | null;
  guest: boolean;
  onClose: () => void;
  onReserve: (q: QueueView) => void;
  onPriority: (q: QueueView) => void;
}) {
  const open = q?.live?.status === "open";
  const priority = q?.priority?.enabled ? q.priority : null;
  const soldOut = q?.live?.priority?.soldOut === true;
  return (
    <Sheet
      visible={visible}
      onDismiss={onClose}
      title="Reserve or skip the line"
    >
      {q ? (
        <>
          <ThemedText type="titleMedium" themeColor="onSurfaceVariant">
            {q.name}
          </ThemedText>
          <ThemedText type="bodyMedium">
            Walk in: go to the business and tap Join, or scan the QR code at the
            counter. Qpeer checks once that you are there. Free.
          </ThemedText>
          {open ? (
            <View style={styles.way}>
              <ThemedText type="bodyMedium">
                Reserve from home: hold a place for a small fee while the queue
                is open, and come when we alert you. You see the fee and the
                refund rules before you pay.
              </ThemedText>
              <Button
                title="Reserve from home"
                variant="tonal"
                icon="event_available"
                onPress={() => onReserve(q)}
                accessibilityLabel={`Reserve a place in ${q.name} from home`}
                needsNetwork
              />
            </View>
          ) : null}
          {priority ? (
            <View style={styles.way}>
              <PriorityChip priority={q.priority} />
              {soldOut ? (
                <Badge label="Priority Pass · sold out today" tone="neutral" />
              ) : (
                <Button
                  title={
                    guest
                      ? "Sign in to buy a Priority Pass"
                      : `Buy Priority Pass · ${formatRupees(priority.feePaise)}`
                  }
                  variant="outlined"
                  icon="bolt"
                  onPress={() => onPriority(q)}
                  needsNetwork
                />
              )}
            </View>
          ) : null}
          {guest ? (
            <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
              Reserving and Priority Passes need a phone or Google sign-in.
            </ThemedText>
          ) : null}
        </>
      ) : null}
    </Sheet>
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
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  flex: { flex: 1 },
  queueTop: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  way: { gap: Spacing.two },
});
