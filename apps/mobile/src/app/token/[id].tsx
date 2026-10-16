import { isActiveState, newerTokenView, type TokenView } from "@qpeer/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  Stack,
  useFocusEffect,
  useIsFocused,
  useLocalSearchParams,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useState } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  HeaderButton,
  Icon,
  type IconName,
  InfoRow,
  LoadingState,
  NumberBadge,
  Screen,
  StatusBanner,
} from "@/components/ui";
import { Radius, Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  queryKeys,
  storeToken,
  useLeaveToken,
  useQueue,
  useToken,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { openDirections } from "@/lib/directions";
import { useLiveSocket } from "@/lib/live";
import { goHome, useAppMode } from "@/lib/mode";
import {
  type AlertPermission,
  alertPermission,
  askForAlertsAfterJoin,
  openBatterySettings,
} from "@/lib/push";
import {
  formatClock,
  formatCountdown,
  formatWaitRange,
  tokenStatusBadge,
  useNow,
} from "@/lib/queue-format";
import { showErrorToast, showToast } from "@/lib/toast";

/** ALR-06 tip: dismissed for this app run (no storage module installed yet). */
let batteryTipDismissed = false;

function endCard(t: TokenView): {
  icon: IconName;
  title: string;
  message: string;
} {
  switch (t.state) {
    case "SERVED":
      return {
        icon: "check_circle",
        title: "You have been served",
        message: `Thanks for visiting ${t.businessName}.`,
      };
    case "LEFT":
      return {
        icon: "logout",
        title: "You left the queue",
        message: "Your place was given up. You can join again any time.",
      };
    case "CANCELLED":
      return {
        icon: "cancel",
        title: "Ticket cancelled",
        message: "This ticket was cancelled.",
      };
    default:
      return t.endReason === "closed"
        ? {
            icon: "event_busy",
            title: "The queue closed for the day",
            message: "This ticket has ended. You can join again when it opens.",
          }
        : {
            icon: "event_busy",
            title: "This ticket has expired",
            message:
              "Your turn passed and the time to come back ran out. You can join again.",
          };
  }
}

/** M5 ticket screen (TOK-01–05, TOK-07; ALR-06 tip). Follows qpeer-client-interface.jpg. */
export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tokenId = id ?? "";
  const theme = useTheme();
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const uid = useAuth().user?.uid ?? null;
  const { mode } = useAppMode();
  const token = useToken(tokenId);
  const t = token.data;
  const active = t ? isActiveState(t.state) : false;
  const queue = useQueue(t?.queueId ?? "");
  const leave = useLeaveToken(tokenId);
  const [tipHidden, setTipHidden] = useState(batteryTipDismissed);
  const [alerts, setAlerts] = useState<AlertPermission>("granted");

  const now = useNow(active && focused, t?.state === "GRACE" ? 1000 : 15_000);

  // TOK-02: live updates; after every (re)connect refetch over HTTP (TOK-03).
  const live = useLiveSocket({
    queueId: t?.queueId ?? null,
    query: `tokenId=${encodeURIComponent(tokenId)}`,
    enabled: active && uid !== null,
    onOpen: () => {
      void token.refetch();
    },
    onMessage: (m) => {
      if (m.type !== "token" || m.token.id !== tokenId) return;
      const before = queryClient.getQueryData<TokenView>(
        queryKeys.token(uid, tokenId),
      );
      // Older than what we show (e.g. sent before our leave): ignore (H1).
      if (newerTokenView(before, m.token) !== m.token) return;
      if (before?.state !== m.token.state) {
        // State changed: also refresh "My tokens".
        storeToken(queryClient, uid, m.token);
      } else {
        queryClient.setQueryData(queryKeys.token(uid, tokenId), m.token);
      }
    },
  });

  // TOK-03: fresh state whenever the screen comes back into view.
  const refetchToken = token.refetch;
  useFocusEffect(
    useCallback(() => {
      const state = queryClient.getQueryState(queryKeys.token(uid, tokenId));
      if (state && Date.now() - state.dataUpdatedAt > 2000) {
        void refetchToken();
      }
      void alertPermission().then(setAlerts);
    }, [queryClient, uid, tokenId, refetchToken]),
  );

  if (!t) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Your Ticket" }} />
        {token.isError ? (
          <ErrorState
            title="Could not load your ticket"
            error={token.error}
            onRetry={() => token.refetch()}
            retrying={token.isFetching}
          />
        ) : (
          <LoadingState label="Loading your ticket…" />
        )}
      </Screen>
    );
  }

  const badge = tokenStatusBadge(t);
  const location = queue.data?.business.location ?? null;
  const called = t.state === "CALLED";

  const onLeave = async () => {
    const ok = await ConfirmDialog.show({
      title: "Leave the queue?",
      message: `You will lose your place (#${t.label}). This cannot be undone.`,
      confirmLabel: "Leave queue",
      cancelLabel: "Stay",
    });
    if (!ok) return;
    try {
      await leave.mutateAsync();
      showToast({ title: "You left the queue", tone: "success" });
    } catch (e) {
      showErrorToast("Could not leave the queue", e);
      void token.refetch();
    }
  };

  const etaText =
    t.etaLowMs !== null && t.etaHighMs !== null
      ? formatWaitRange(t.etaLowMs - now, t.etaHighMs - now)
      : null;

  return (
    <Screen
      refreshing={token.isRefetching}
      onRefresh={() => {
        void token.refetch();
        void queue.refetch();
      }}
    >
      <Stack.Screen
        options={{
          title: "Your Ticket",
          headerStyle: { backgroundColor: theme.header },
          headerTintColor: theme.onPrimary,
          headerTitleStyle: { ...Type.heading, color: theme.onPrimary },
          headerShadowVisible: false,
        }}
      />
      {focused ? <StatusBar style="light" /> : null}

      {/* Dark band with the white ticket card (qpeer-client-interface.jpg). */}
      <View style={[styles.band, { backgroundColor: theme.header }]}>
        <Card style={styles.ticket}>
          <NumberBadge label={t.label} color={called ? "brand" : "primary"} />
          <InfoRow label="Queue" value={t.queueName} />
          <InfoRow label="Business" value={t.businessName} />
          <View style={styles.statusRow}>
            <ThemedText type="body" themeColor="inkMuted">
              Status
            </ThemedText>
            <Badge label={badge.label} tone={badge.tone} />
          </View>
          <InfoRow
            label="Now serving"
            value={t.nowServing ? `#${t.nowServing}` : "Nobody yet"}
          />
          {t.state === "WAITING" ? (
            <InfoRow label="People ahead" value={String(t.peopleAhead)} />
          ) : null}
          {t.state === "WAITING" && etaText ? (
            <InfoRow label="Estimated wait" value={etaText} />
          ) : null}
          {t.state === "WAITING" && t.beBackByMs !== null ? (
            <InfoRow label="Be back by" value={formatClock(t.beBackByMs)} />
          ) : null}
          {(called || t.state === "GRACE") && t.counter !== null ? (
            <InfoRow label="Counter" value={String(t.counter)} />
          ) : null}
          <InfoRow label="Joined" value={formatClock(t.joinedAt)} />
        </Card>
        {active ? (
          <ThemedText
            type="small"
            themeColor="onPrimary"
            style={styles.liveLine}
            accessibilityLiveRegion="polite"
          >
            {live === "live"
              ? "● Live — updates by itself"
              : "Reconnecting… pull down to refresh"}
          </ThemedText>
        ) : null}
      </View>

      {/* TOK-04: each state looks different. */}
      {called ? (
        <Card style={{ backgroundColor: theme.brand }}>
          <View style={styles.headline}>
            <Icon name="campaign" size={32} color="onPrimary" />
            <ThemedText type="title" themeColor="onPrimary">
              It's your turn
            </ThemedText>
          </View>
          <ThemedText type="heading" themeColor="onPrimary">
            {t.counter !== null
              ? `Go to Counter ${t.counter} now`
              : "Go to the counter now"}
          </ThemedText>
        </Card>
      ) : t.state === "GRACE" ? (
        <Card style={{ backgroundColor: theme.warningSoft }}>
          <View style={styles.headline}>
            <Icon name="hourglass_top" size={32} color="warning" />
            <ThemedText type="heading">You missed your call</ThemedText>
          </View>
          <ThemedText type="title" accessibilityLiveRegion="polite">
            {t.graceUntil !== null && t.graceUntil > now
              ? `Come to the counter within ${formatCountdown(t.graceUntil - now)}`
              : "Come to the counter now"}
          </ThemedText>
          <ThemedText type="small" themeColor="inkMuted">
            Tell the staff your number ({`#${t.label}`}). After that your ticket
            expires.
          </ThemedText>
        </Card>
      ) : t.state === "WAITING" && t.queueStatus === "paused" ? (
        <StatusBanner
          tone="paused"
          title="The queue is paused"
          detail="Your place is kept. Wait times update when it resumes."
        />
      ) : t.state === "WAITING" ? (
        <StatusBanner
          tone="active"
          title={
            t.peopleAhead === 0
              ? "You are next"
              : `${t.peopleAhead} ${t.peopleAhead === 1 ? "person" : "people"} ahead`
          }
          detail={
            etaText
              ? `${etaText}. We will alert you when it's time to head back.`
              : "We will alert you when it's time to head back."
          }
        />
      ) : null}

      {!active ? (
        <Card style={styles.end}>
          <Icon name={endCard(t).icon} size={40} color="inkMuted" />
          <ThemedText type="heading" style={styles.centre}>
            {endCard(t).title}
          </ThemedText>
          <ThemedText type="body" themeColor="inkMuted" style={styles.centre}>
            {endCard(t).message}
          </ThemedText>
          <Button
            title="Back to home"
            variant="brand"
            icon="home"
            onPress={() => goHome(mode)}
            style={styles.stretch}
          />
        </Card>
      ) : null}

      {active ? (
        <View style={styles.actions}>
          <Button
            title="Directions"
            variant="outline"
            icon="directions"
            disabled={!location}
            onPress={() => {
              if (location) {
                openDirections(location.lat, location.lng, t.businessName);
              }
            }}
            style={styles.flex}
          />
          <Button
            title="Leave queue"
            variant="danger-soft"
            icon="logout"
            loading={leave.isPending}
            onPress={() => void onLeave()}
            style={styles.flex}
          />
        </View>
      ) : null}

      {active && alerts !== "granted" ? (
        <Card>
          <View style={styles.headline}>
            <Icon name="notifications" color="warning" />
            <ThemedText type="heading">Alerts are off</ThemedText>
          </View>
          <ThemedText type="small" themeColor="inkMuted">
            Without alerts you need to keep checking this screen. Turn them on
            to hear when to head back and when you are called.
          </ThemedText>
          <Button
            title={alerts === "denied" ? "Open settings" : "Turn on alerts"}
            variant="secondary"
            icon="notifications_active"
            onPress={async () => {
              if (alerts === "denied") {
                await Linking.openSettings();
              } else if (uid) {
                await askForAlertsAfterJoin(uid);
              }
              setAlerts(await alertPermission());
            }}
          />
        </Card>
      ) : null}

      {active && Platform.OS === "android" && !tipHidden ? (
        <Card>
          <View style={styles.tipHead}>
            <Icon name="battery_saver" color="primary" />
            <ThemedText type="body" style={styles.flex}>
              Allow Qpeer to run in the background so alerts arrive on time
            </ThemedText>
            <HeaderButton
              title="Dismiss"
              color="inkMuted"
              onPress={() => {
                batteryTipDismissed = true;
                setTipHidden(true);
              }}
            />
          </View>
          <ThemedText type="small" themeColor="inkMuted">
            In the list, find Qpeer and choose "Don't optimise" (or "Not
            optimised").
          </ThemedText>
          <Button
            title="Open battery settings"
            variant="secondary"
            icon="settings"
            onPress={() => void openBatterySettings()}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  band: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  ticket: { gap: Spacing.one, paddingTop: Spacing.four },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.one,
  },
  liveLine: { textAlign: "center" },
  headline: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  end: { alignItems: "center", gap: Spacing.twoHalf },
  centre: { textAlign: "center" },
  stretch: { alignSelf: "stretch" },
  actions: { flexDirection: "row", gap: Spacing.twoHalf },
  flex: { flex: 1 },
  tipHead: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
});
