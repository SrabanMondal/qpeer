import { approxDuration, isActiveState, type TokenView } from "@qpeer/shared";
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
import QRCode from "react-native-qrcode-svg";

import { ThemedText } from "@/components/themed-text";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
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
  mergeToken,
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
import { OFFLINE_ACTION_TEXT, useOffline } from "@/lib/network";
import {
  type AlertPermission,
  alertPermission,
  askForAlertsAfterJoin,
  openBatterySettings,
} from "@/lib/push";
import {
  formatAge,
  formatClock,
  formatCountdown,
  formatDateTime,
  tokenStatusBadge,
  useNow,
} from "@/lib/queue-format";
import { useSavedTicket, useStored } from "@/lib/storage";
import { showErrorToast, showToast } from "@/lib/toast";

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
        : t.endReason === "validity"
          ? {
              icon: "event_busy",
              title: "This ticket's time ran out",
              message:
                "It was valid for a set time that has now passed. You can join again.",
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
  // C1: the last view saved on the phone, for offline (also a cold start).
  const saved = useSavedTicket(uid, tokenId);
  const offline = useOffline();
  const t = token.data ?? saved?.view;
  const fromSaved = !token.data && saved !== undefined;
  const active = t ? isActiveState(t.state) : false;
  const queue = useQueue(t?.queueId ?? "");
  const leave = useLeaveToken(tokenId);
  const tip = useStored("batteryTipDismissed");
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
      if (before && before.rev > m.token.rev) return;
      if (before?.state !== m.token.state) {
        // State changed: also refresh "My tokens".
        storeToken(queryClient, uid, m.token);
      } else {
        // Keeps the signed ticket the socket view doesn't carry (C3) and
        // saves the view on the phone (C1).
        mergeToken(queryClient, uid, m.token);
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
        {offline ? (
          <EmptyState
            icon="cloud_off"
            title="This ticket isn't saved on this phone"
            message="It shows as soon as you're online. Your place in the queue is kept."
          />
        ) : token.isError ? (
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

  // One wait formula on every surface (coordinator report 2026-10-16): the
  // DO's range, shown as its midpoint like the map, list and join screen.
  const etaText =
    t.etaLowMs !== null && t.etaHighMs !== null
      ? approxDuration(t.etaLowMs - now, t.etaHighMs - now)
      : null;
  const carried = t.carriedOver === true;
  const closedKept = active && t.queueStatus === "closed";
  // While offline (or showing a saved view) the time of the last update is
  // what matters; the live line says "Last updated N min ago".
  const updatedAt = fromSaved
    ? (saved?.savedAt ?? null)
    : token.dataUpdatedAt || null;
  const stale = offline || fromSaved || live !== "live";

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
          {active ? (
            <InfoRow
              label="Valid until"
              value={
                t.expiresAt
                  ? formatDateTime(t.expiresAt)
                  : "The queue closes for the day"
              }
            />
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
            {!stale
              ? "● Live — updates by itself"
              : updatedAt !== null
                ? `Last updated ${formatAge(updatedAt)}${offline ? " · offline" : " · reconnecting…"}`
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
      ) : closedKept ? (
        <StatusBanner
          tone="paused"
          title="The queue is closed — your ticket is kept"
          detail={`You keep number #${t.label} and go first when it opens again${t.expiresAt ? `, if that is before ${formatDateTime(t.expiresAt)}` : ""}.`}
        />
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
            disabled={offline}
            onPress={() => void onLeave()}
            style={styles.flex}
          />
        </View>
      ) : null}
      {active && offline ? (
        <ThemedText type="small" themeColor="inkMuted">
          {OFFLINE_ACTION_TEXT} Your place is kept.
        </ThemedText>
      ) : null}
      {active && carried && !closedKept ? (
        <ThemedText type="small" themeColor="inkMuted">
          Kept from an earlier session: you keep number #{t.label} and are
          served first.
        </ThemedText>
      ) : null}

      {/* C3: signed ticket staff can check, also without internet. */}
      {active && t.signedTicket ? (
        <Card style={styles.qrCard}>
          <ThemedText type="heading">Your ticket code</ThemedText>
          <View style={styles.qrBox}>
            <QRCode value={t.signedTicket} size={200} quietZone={12} ecl="M" />
          </View>
          <ThemedText type="small" themeColor="inkMuted" style={styles.centre}>
            Staff can scan it to check your ticket. It works without internet.
          </ThemedText>
        </Card>
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

      {active && Platform.OS === "android" && tip.ready && !tip.value ? (
        <Card>
          <View style={styles.tipHead}>
            <Icon name="battery_saver" color="primary" />
            <ThemedText type="body" style={styles.flex}>
              Allow Qpeer to run in the background so alerts arrive on time
            </ThemedText>
            <HeaderButton
              title="Dismiss"
              color="inkMuted"
              onPress={() => tip.set(true)}
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
  qrCard: { alignItems: "center", gap: Spacing.two },
  // The QR's quiet zone stays pure white in both themes so scanners read it.
  qrBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.card,
    overflow: "hidden",
  },
});
