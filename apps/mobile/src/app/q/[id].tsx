import { openLook, waitText } from "@qpeer/shared";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import { PriorityChip } from "@/components/priority-chip";
import { ProblemCard } from "@/components/problem-card";
import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  InfoRow,
  LoadingState,
  Screen,
  StatusBanner,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { ApiError, useJoinQueue, useQueue } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  type JoinProblem,
  joinErrorView,
  locationProblemView,
} from "@/lib/join-errors";
import { isQueueId } from "@/lib/join-link";
import { readJoinLocation, turnOnLocation } from "@/lib/join-location";
import { OFFLINE_ACTION_TEXT, useOffline } from "@/lib/network";
import { askForAlertsAfterJoin } from "@/lib/push";
import { liveStatusLook, useNow } from "@/lib/queue-format";
import { showToast } from "@/lib/toast";
import { PriorityBuyCard } from "@/screens/priority-buy-card";

type Phase = "idle" | "locating" | "joining";

/**
 * Join screen (JON-02 deep link `qpeer://q/<id>`, JON-03 info before joining,
 * JON-04–07 walk-in GPS check and its errors).
 */
export default function JoinScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const valid = isQueueId(params.id);
  const id = valid ? params.id.toLowerCase() : "";
  const uid = useAuth().user?.uid ?? null;
  const info = useQueue(id);
  const join = useJoinQueue(id);
  const offline = useOffline();
  const now = useNow(true, 30_000);
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<JoinProblem | null>(null);

  const openTicket = (tokenId: string) =>
    router.replace({ pathname: "/token/[id]", params: { id: tokenId } });

  const doJoin = async () => {
    if (phase !== "idle") return;
    setProblem(null);
    setPhase("locating");
    try {
      const loc = await readJoinLocation();
      if (!loc.ok) {
        setProblem(locationProblemView(loc.problem));
        return;
      }
      setPhase("joining");
      const token = await join.mutateAsync(loc.body);
      // ALR-01/02: explain and ask for alerts once, then register the token.
      if (uid) await askForAlertsAfterJoin(uid);
      openTicket(token.id);
    } catch (e) {
      const view = joinErrorView(e);
      if (view.fix === "open_ticket" && view.tokenId) {
        showToast({ title: "You are already in this queue", tone: "info" });
        openTicket(view.tokenId);
        return;
      }
      setProblem(view);
      // Status may have changed (closed/paused/full): show the latest.
      if (e instanceof ApiError && e.status === 409) void info.refetch();
    } finally {
      setPhase("idle");
    }
  };

  const runFix = async (p: JoinProblem) => {
    switch (p.fix) {
      case "retry":
        await doJoin();
        return;
      case "open_settings":
        await Linking.openSettings();
        return;
      case "turn_on_location":
        if (await turnOnLocation()) await doJoin();
        return;
      case "open_ticket":
        if (p.tokenId) openTicket(p.tokenId);
        return;
      default:
        return;
    }
  };

  if (!valid) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Join queue" }} />
        <EmptyState
          icon="qr_code_scanner"
          title="This isn't a Qpeer queue link"
          message="Scan the QR code shown at the business counter."
          action={
            <Button
              title="Scan QR code"
              icon="qr_code_scanner"
              onPress={() => router.replace("/scan")}
            />
          }
        />
      </Screen>
    );
  }

  if (!info.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Join queue" }} />
        {info.isError ? (
          <ErrorState
            title="Could not load this queue"
            error={info.error}
            onRetry={() => info.refetch()}
            retrying={info.isFetching}
          />
        ) : (
          <LoadingState label="Loading the queue…" />
        )}
      </Screen>
    );
  }

  const { queue, business, live, myRole, joinRadiusM } = info.data;
  // PRI-07: the queue's public priority fields (with "Sold out").
  const priority =
    info.data.priority ??
    (queue.priority
      ? { ...queue.priority, soldOut: live.priority?.soldOut ?? false }
      : null);
  const status = liveStatusLook(live.status);
  // B16: the queue state decides; the hours only add "(after usual hours)".
  const look = openLook(live.status, business.isOpenNow);
  const busy = phase !== "idle";
  const open = live.status === "open";
  const wait = open ? waitText(live, now) : null;

  return (
    <Screen
      refreshing={info.isRefetching}
      onRefresh={() => {
        void info.refetch();
      }}
      // "Join queue" stays under the thumb; the status line sits under it.
      bottomBar={
        <>
          <Button
            title={problem?.fix === "retry" ? "Try again" : "Join queue"}
            size="large"
            icon="how_to_reg"
            onPress={() => void doJoin()}
            loading={busy}
            disabled={!open || offline}
            accessibilityLabel={`Join ${queue.name} at ${business.name}`}
          />
          <ThemedText
            type="bodySmall"
            themeColor="onSurfaceVariant"
            accessibilityLiveRegion="polite"
          >
            {phase === "locating"
              ? "Checking your location…"
              : phase === "joining"
                ? "Joining…"
                : offline
                  ? OFFLINE_ACTION_TEXT
                  : open
                    ? `Walk-in check: you must be within ${joinRadiusM} m. Your location is checked once to confirm you are here. It is not stored.`
                    : "Joining opens when the queue is open."}
          </ThemedText>
        </>
      }
    >
      <Stack.Screen options={{ title: "Join queue" }} />

      <View style={styles.head}>
        <ThemedText type="headlineSmall">{business.name}</ThemedText>
        <ThemedText type="titleMedium" themeColor="onSurfaceVariant">
          {queue.name}
        </ThemedText>
        {business.address ? (
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {business.address}
          </ThemedText>
        ) : null}
      </View>

      <StatusBanner
        tone={status.tone}
        title={look.label}
        detail={
          business.todayHours ? `Today: ${business.todayHours.text}` : undefined
        }
      />

      <Card>
        <PriorityChip priority={priority} />
        <InfoRow
          label="Now serving"
          value={live.nowServing ? `#${live.nowServing}` : "Nobody yet"}
        />
        <InfoRow label="People waiting" value={String(live.waiting)} />
        <InfoRow
          label="Estimated wait"
          value={open ? (wait ?? "Not known yet") : "—"}
        />
      </Card>

      {problem ? (
        <ProblemCard problem={problem} onFix={(p) => void runFix(p)} />
      ) : null}

      {myRole ? (
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          You manage this queue. You can still join it as a customer, for
          example to test it.
        </ThemedText>
      ) : null}

      {priority?.enabled ? (
        <PriorityBuyCard
          queueId={queue.id}
          feePaise={priority.feePaise}
          soldOut={priority.soldOut}
          live={live}
          now={now}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.half },
});
