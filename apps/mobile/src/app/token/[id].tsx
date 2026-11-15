import { approxDuration, isActiveState, type TokenView } from "@qpeer/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  Stack,
  useFocusEffect,
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { PriorityChip } from "@/components/priority-chip";
import { ThemedText } from "@/components/themed-text";
import {
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
  Screen,
  Sheet,
  StatRow,
  TokenBoard,
} from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  mergeToken,
  queryKeys,
  storeToken,
  useCancelToken,
  useLeaveToken,
  useQueue,
  useToken,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { openDirections } from "@/lib/directions";
import { useLiveSocket } from "@/lib/live";
import { goHome, useAppMode } from "@/lib/mode";
import { useOffline } from "@/lib/network";
import { payHref } from "@/lib/pay-flow";
import {
  type AlertPermission,
  alertPermission,
  askForAlertsAfterJoin,
  openBatterySettings,
} from "@/lib/push";
import {
  formatAge,
  formatClock,
  formatDateTime,
  formatWaitRange,
  peopleAheadText,
  ticketTitle,
  useNow,
} from "@/lib/queue-format";
import { useSavedTicket, useStored } from "@/lib/storage";
import { ticketBoard } from "@/lib/ticket-board";
import { showErrorToast, showToast } from "@/lib/toast";
import {
  BookedCard,
  CheckInAction,
  canRejoin,
  MissedAction,
  MissedCard,
  SkipAheadCard,
  useGpsAction,
} from "@/screens/ticket-cards";

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
        title: t.cls === "priority" ? "Pass cancelled" : "Ticket cancelled",
        message: t.paid
          ? "This ticket was cancelled. Any refund shows in Profile → My payments."
          : "This ticket was cancelled.",
      };
    default:
      if (t.endReason === "closed") {
        return {
          icon: "event_busy",
          title: "The queue closed for the day",
          message: t.paid
            ? "This ticket has ended. If you were not served, the fee is refunded automatically. You can join again when it opens."
            : "This ticket has ended. You can join again when it opens.",
        };
      }
      if (t.endReason === "validity") {
        return {
          icon: "event_busy",
          title:
            t.cls === "priority" && t.checkedInAt == null
              ? "This pass ended before check-in"
              : "This ticket's time ran out",
          message:
            "It was valid for a set time that has now passed. You can join again.",
        };
      }
      // Second miss, or a missed turn never rejoined (QUE-24).
      return {
        icon: "event_busy",
        title: t.rejoined
          ? "Your turn passed again"
          : "This ticket has expired",
        message: t.rejoined
          ? "You missed your turn after rejoining, so this ticket has ended. You're welcome to join again."
          : "Your turn passed and the time to come back ran out. You're welcome to join again.",
      };
  }
}

/** "4:12" → "4 min 12 s" (the figure under the board while in GRACE). */
function countdownFigure(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${s % 60} s` : `${s % 60} s`;
}

/**
 * M5 ticket screen (TOK-01–05, TOK-07; ALR-06 tip). A reading screen: the
 * hero is the token board (design guide §1, §5a). Under it the figures for
 * the state, then Directions and Leave queue. The state's one action ("I'm
 * here", "Check in", "Back to home") sits in the pinned bottom bar; the
 * ticket code opens in a sheet.
 */
export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tokenId = id ?? "";
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const uid = useAuth().user?.uid ?? null;
  const { mode } = useAppMode();
  const theme = useTheme();
  const token = useToken(tokenId);
  // C1: the last view saved on the phone, for offline (also a cold start).
  const saved = useSavedTicket(uid, tokenId);
  const offline = useOffline();
  const t = token.data ?? saved?.view;
  const fromSaved = !token.data && saved !== undefined;
  const active = t ? isActiveState(t.state) : false;
  const queue = useQueue(t?.queueId ?? "");
  const leave = useLeaveToken(tokenId);
  const cancel = useCancelToken(tokenId);
  const router = useRouter();
  const tip = useStored("batteryTipDismissed");
  const [alerts, setAlerts] = useState<AlertPermission>("granted");
  const [codeOpen, setCodeOpen] = useState(false);

  const onPositionChange = (fresh: TokenView, title: string) => {
    showToast({
      title,
      message:
        fresh.state === "WAITING"
          ? `${peopleAheadText(fresh.peopleAhead, fresh.peopleAheadHigh)} ahead of you.`
          : undefined,
      tone: "success",
    });
  };
  // "I'm here" (MISSED) or "Check in" (BOOKED pass): the GPS check whose
  // button sits in the pinned bar.
  const checkIn = t?.state === "BOOKED";
  const gps = useGpsAction(tokenId, checkIn ? "checkin" : "rejoin", (fresh) =>
    onPositionChange(
      fresh,
      checkIn
        ? `Checked in — you're #${fresh.label} in the priority lane`
        : "You're back in the line",
    ),
  );

  // GRACE: the countdown ticks every second (R3).
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
        <Stack.Screen options={{ title: "Your ticket" }} />
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

  const location = queue.data?.business.location ?? null;
  const address = queue.data?.business.address ?? null;
  const grace = t.state === "GRACE";

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

  // PAY-07 / PRI-09: paid tickets are cancelled; the refund is shown first.
  const onCancel = async () => {
    const pct = t.cancelRefundPct ?? 0;
    const booked = t.state === "BOOKED";
    const what = booked ? "pass" : "ticket";
    const ok = await ConfirmDialog.show({
      title: booked ? "Cancel your Priority Pass?" : "Cancel your paid ticket?",
      message:
        pct >= 100
          ? `You get the full fee back. Your place (${ticketTitle(t)}) is given up. This cannot be undone.`
          : pct > 0
            ? `You get ${pct}% of the fee back. The rest is kept by the business and Qpeer. This cannot be undone.`
            : `No refund: ${
                booked
                  ? "this pass can no longer be refunded"
                  : t.lane === "priority" || t.cls === "priority"
                    ? "a ticket in the priority lane keeps its fee"
                    : "it is too close to your turn"
              }. Your place (${ticketTitle(t)}) is given up. This cannot be undone.`,
      confirmLabel: `Cancel ${what}`,
      cancelLabel: booked ? "Keep pass" : "Stay",
    });
    if (!ok) return;
    try {
      const r = await cancel.mutateAsync();
      showToast({
        title: booked ? "Pass cancelled" : "Ticket cancelled",
        message: r.refund
          ? `A refund of ${r.refundPct ?? 100}% of the fee has started. It takes 5–7 days to reach your account.`
          : "No refund for this cancel.",
        tone: "success",
      });
    } catch (e) {
      showErrorToast(`Could not cancel the ${what}`, e);
      void token.refetch();
    }
  };

  // One wait formula on every surface (coordinator report 2026-10-16): the
  // DO's range, shown as its midpoint like the map, list and join screen.
  // With the priority lane on a regular's people ahead is a range (C3):
  // then the wait is shown as a range too.
  const ranged = t.peopleAheadHigh != null && t.peopleAheadHigh > t.peopleAhead;
  const etaText =
    t.etaLowMs !== null && t.etaHighMs !== null
      ? ranged
        ? formatWaitRange(t.etaLowMs - now, t.etaHighMs - now)
        : approxDuration(t.etaLowMs - now, t.etaHighMs - now)
      : null;
  const aheadText = peopleAheadText(t.peopleAhead, t.peopleAheadHigh);
  const booked = t.state === "BOOKED";
  const missed = t.state === "MISSED";
  const waiting = t.state === "WAITING";
  const carried = t.carriedOver === true;
  const closedKept = active && t.queueStatus === "closed";
  const paused = waiting && t.queueStatus === "paused";
  // While offline (or showing a saved view) the time of the last update is
  // what matters; the live line says "Last updated N min ago". The normal,
  // live case needs no line at all.
  const updatedAt = fromSaved
    ? (saved?.savedAt ?? null)
    : token.dataUpdatedAt || null;
  const stale = offline || fromSaved || live !== "live";
  const board = ticketBoard(t, now);
  const graceEnds = t.graceEndsAt ?? t.graceUntil;
  const graceLeft = graceEnds !== null ? graceEnds - now : 0;
  const showTip =
    active && Platform.OS === "android" && tip.ready && !tip.value;

  // The pinned bar holds the state's one action.
  const bar =
    missed && canRejoin(t) ? (
      <MissedAction gps={gps} />
    ) : booked ? (
      <CheckInAction t={t} gps={gps} />
    ) : !active ? (
      <Button
        title="Back to home"
        size="large"
        icon="home"
        onPress={() => goHome(mode)}
      />
    ) : undefined;

  return (
    <Screen
      refreshing={token.isRefetching}
      onRefresh={() => {
        void token.refetch();
        void queue.refetch();
      }}
      bottomBar={bar}
    >
      <Stack.Screen options={{ title: "Your ticket" }} />

      {/* Where: the business and queue, then the address. */}
      <View style={styles.place}>
        <ThemedText type="titleMedium">
          {`${t.businessName} · ${t.queueName}`}
        </ThemedText>
        {address ? (
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {address}
          </ThemedText>
        ) : null}
        {active ? <PriorityChip priority={t.priority} /> : null}
      </View>

      {/* The hero: the token board (R2 check code on its top row). */}
      <View style={styles.boardBlock}>
        <TokenBoard
          top={board.top}
          number={board.number}
          numberTone={board.numberTone}
          bottom={board.bottom}
          accessibilityLabel={board.label}
          relightKey={board.relightKey}
        />
        {active && stale ? (
          <ThemedText
            type="bodySmall"
            themeColor="onSurfaceVariant"
            style={styles.centre}
            accessibilityLiveRegion="polite"
          >
            {updatedAt !== null
              ? `Last updated ${formatAge(updatedAt)}${offline ? " · offline · your place is kept" : " · reconnecting…"}`
              : "Reconnecting… pull down to refresh"}
          </ThemedText>
        ) : null}
        {active && alerts !== "granted" ? (
          <View
            style={[
              styles.alertsRow,
              { backgroundColor: theme.surfaceContainerLow },
            ]}
          >
            <Icon name="notifications_off" color="onSurfaceVariant" />
            <ThemedText type="bodyLarge" style={styles.flex}>
              Alerts are off
            </ThemedText>
            <HeaderButton
              title="Turn on"
              accessibilityLabel={
                alerts === "denied"
                  ? "Turn on alerts in the phone's settings"
                  : "Turn on alerts"
              }
              onPress={async () => {
                if (alerts === "denied") {
                  await Linking.openSettings();
                } else if (uid) {
                  await askForAlertsAfterJoin(uid);
                }
                setAlerts(await alertPermission());
              }}
            />
          </View>
        ) : null}
      </View>

      {/* TOK-04: each state reads differently. Figures in Archivo. */}
      {grace ? (
        <>
          <StatRow
            stats={[
              { label: "Your turn", value: "Now" },
              {
                label: "Time left",
                value: graceLeft > 0 ? countdownFigure(graceLeft) : "Come now",
              },
            ]}
          />
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            Tell the staff your number. If the time runs out your turn is
            missed; you can then rejoin once with I'm here.
          </ThemedText>
        </>
      ) : missed ? (
        <MissedCard t={t} now={now} gps={gps} />
      ) : booked ? (
        <BookedCard
          t={t}
          gps={gps}
          cancelling={cancel.isPending}
          onCancel={() => void onCancel()}
        />
      ) : closedKept ? (
        // The board says "QUEUE CLOSED · NUMBER KEPT".
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          {`You go first when it opens again${t.expiresAt ? `, if that is before ${formatDateTime(t.expiresAt)}` : ""}.`}
        </ThemedText>
      ) : paused ? (
        // The board says "QUEUE PAUSED · PLACE KEPT".
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          Wait times update when it resumes.
        </ThemedText>
      ) : waiting ? (
        <View style={styles.group}>
          <StatRow
            stats={[
              { label: "People ahead", value: aheadText },
              {
                label: "Your turn in",
                value: etaText ?? (t.peopleAhead === 0 ? "Next" : "—"),
              },
            ]}
          />
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {[
              t.peopleAhead === 0 && !ranged ? "You are next." : null,
              alerts === "granted"
                ? "We will alert you when it's time to head back."
                : null,
              ranged
                ? "The range allows for priority customers who may check in ahead of you."
                : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </ThemedText>
        </View>
      ) : null}

      {waiting && !offline ? (
        <SkipAheadCard
          t={t}
          onPress={() =>
            router.push(
              payHref({ kind: "upgrade", queueId: t.queueId, tokenId: t.id }),
            )
          }
        />
      ) : null}

      {!active ? (
        <Card style={styles.end} tone="surfaceContainerLow">
          <Icon name={endCard(t).icon} size={40} color="onSurfaceVariant" />
          <ThemedText type="titleLarge" style={styles.centre}>
            {endCard(t).title}
          </ThemedText>
          <ThemedText
            type="bodyLarge"
            themeColor="onSurfaceVariant"
            style={styles.centre}
          >
            {endCard(t).message}
          </ThemedText>
        </Card>
      ) : null}

      {active ? (
        <View style={styles.actions}>
          <Button
            title="Directions"
            variant="outlined"
            icon="directions"
            disabled={!location}
            onPress={() => {
              if (location) {
                openDirections(location.lat, location.lng, t.businessName);
              }
            }}
            style={styles.flex}
          />
          {booked ? null : t.paid ? (
            <Button
              title="Cancel ticket"
              variant="danger"
              icon="close"
              loading={cancel.isPending}
              disabled={offline}
              onPress={() => void onCancel()}
              style={styles.flex}
            />
          ) : (
            <Button
              title="Leave queue"
              variant="danger"
              icon="logout"
              loading={leave.isPending}
              disabled={offline}
              onPress={() => void onLeave()}
              style={styles.flex}
            />
          )}
        </View>
      ) : null}
      {active && t.paid && !booked && t.cancelRefundPct != null ? (
        <ThemedText type="bodySmall" themeColor="onSurfaceVariant">
          {t.cancelRefundPct >= 100
            ? "Cancelling now gives the full fee back."
            : t.cancelRefundPct > 0
              ? `Cancelling now gives ${t.cancelRefundPct}% of the fee back.`
              : "Cancelling now gives no refund."}
        </ThemedText>
      ) : null}
      {active && carried && !closedKept ? (
        <ThemedText type="bodySmall" themeColor="onSurfaceVariant">
          Kept from an earlier session: you keep number #{t.label} and are
          served first.
        </ThemedText>
      ) : null}

      {/* C3: the signed ticket staff can check, also without internet. */}
      {active && t.signedTicket ? (
        <Button
          title="Show ticket code"
          variant="tonal"
          icon="qr_code_2"
          onPress={() => setCodeOpen(true)}
        />
      ) : null}

      {/* Times that are not on the board (the rest is shown above). */}
      {active ? (
        <View>
          {waiting && t.beBackByMs !== null ? (
            <InfoRow label="Be back by" value={formatClock(t.beBackByMs)} />
          ) : null}
          {!booked && !missed && t.expiresAt ? (
            <InfoRow label="Valid until" value={formatDateTime(t.expiresAt)} />
          ) : null}
          {t.signedTicket ? null : (
            <InfoRow label="Joined" value={formatClock(t.joinedAt)} />
          )}
        </View>
      ) : null}

      {active && t.signedTicket ? (
        <Sheet
          visible={codeOpen}
          onDismiss={() => setCodeOpen(false)}
          title="Your ticket code"
        >
          <View style={styles.qrBlock}>
            <View style={styles.qrBox}>
              <QRCode
                value={t.signedTicket}
                size={200}
                quietZone={12}
                ecl="M"
              />
            </View>
            <ThemedText
              type="bodyMedium"
              themeColor="onSurfaceVariant"
              style={styles.centre}
            >
              Staff can scan it to check your ticket. It works without internet.
            </ThemedText>
          </View>
          <InfoRow label="Joined" value={formatClock(t.joinedAt)} />
        </Sheet>
      ) : null}

      {/* ALR-06: a one-time setup step, shown once as a sheet (Profile keeps
          a permanent "Alerts and battery" row). */}
      <Sheet
        visible={showTip}
        onDismiss={() => tip.set(true)}
        title="Let alerts arrive on time"
      >
        <ThemedText type="bodyLarge">
          Allow Qpeer to run in the background. In the list, find Qpeer and
          choose "Don't optimise" (or "Not optimised").
        </ThemedText>
        <Button
          title="Open battery settings"
          size="large"
          icon="battery_saver"
          onPress={() => {
            tip.set(true);
            void openBatterySettings();
          }}
        />
        <Button title="Not now" variant="text" onPress={() => tip.set(true)} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  place: { gap: Spacing.half },
  boardBlock: { gap: Spacing.two },
  group: { gap: Spacing.two },
  alertsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
    minHeight: 56,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    borderRadius: Radius.card,
  },
  end: { alignItems: "center", gap: Spacing.twoHalf },
  centre: { textAlign: "center" },
  actions: { flexDirection: "row", gap: Spacing.twoHalf },
  flex: { flex: 1 },
  qrBlock: { alignItems: "center", gap: Spacing.two },
  // The QR's quiet zone stays pure white in both themes so scanners read it.
  qrBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.card,
    overflow: "hidden",
  },
});
