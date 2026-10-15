import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking } from "react-native";

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
import { ApiError, useJoinQueue, useQueue } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { categoryLabel } from "@/lib/format";
import {
  type JoinProblem,
  joinErrorView,
  locationProblemView,
} from "@/lib/join-errors";
import { isQueueId } from "@/lib/join-link";
import { readJoinLocation, turnOnLocation } from "@/lib/join-location";
import { askForAlertsAfterJoin } from "@/lib/push";
import { formatWaitRange, liveStatusLook } from "@/lib/queue-format";
import { showToast } from "@/lib/toast";

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
              variant="brand"
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

  const { queue, business, live, myRole } = info.data;
  const status = liveStatusLook(live.status);
  const radius = queue.settings?.joinRadiusM;
  const walkInLine =
    radius !== undefined
      ? `Walk-in check: you must be within ${radius} m`
      : "Walk-in check: you must be at the business";
  const busy = phase !== "idle";
  const open = live.status === "open";

  return (
    <Screen
      refreshing={info.isRefetching}
      onRefresh={() => {
        void info.refetch();
      }}
    >
      <Stack.Screen options={{ title: "Join queue" }} />

      <Card>
        <ThemedText type="label" themeColor="inkMuted">
          {categoryLabel(business.category).toUpperCase()}
        </ThemedText>
        <ThemedText type="title">{business.name}</ThemedText>
        <ThemedText type="heading" themeColor="inkMuted">
          {queue.name}
        </ThemedText>
        {business.address ? (
          <ThemedText type="small" themeColor="inkMuted">
            {business.address}
          </ThemedText>
        ) : null}
      </Card>

      <StatusBanner
        tone={status.tone}
        title={
          live.status === "open"
            ? "Open now"
            : live.status === "paused"
              ? "Paused for a moment"
              : "Closed right now"
        }
        detail={walkInLine}
      />

      <Card>
        <InfoRow
          label="Now serving"
          value={live.nowServing ? `#${live.nowServing}` : "Nobody yet"}
        />
        <InfoRow label="People waiting" value={String(live.waiting)} />
        <InfoRow
          label="Estimated wait"
          value={
            live.waitLowMs !== null && live.waitHighMs !== null
              ? formatWaitRange(live.waitLowMs, live.waitHighMs)
              : open
                ? "Not known yet"
                : "—"
          }
        />
      </Card>

      {problem ? (
        <Card>
          <ThemedText type="heading" themeColor="danger">
            {problem.title}
          </ThemedText>
          <ThemedText type="body">{problem.message}</ThemedText>
          {problem.support ? (
            <ThemedText type="small" themeColor="inkMuted" selectable>
              {problem.support}
            </ThemedText>
          ) : null}
          {problem.fix === "open_settings" ? (
            <Button
              title="Open settings"
              variant="secondary"
              icon="settings"
              onPress={() => void runFix(problem)}
            />
          ) : problem.fix === "turn_on_location" ? (
            <Button
              title="Turn on location"
              variant="secondary"
              icon="my_location"
              onPress={() => void runFix(problem)}
            />
          ) : problem.fix === "open_ticket" ? (
            <Button
              title="Open my ticket"
              variant="secondary"
              icon="confirmation_number"
              onPress={() => void runFix(problem)}
            />
          ) : null}
        </Card>
      ) : null}

      <Button
        title={problem?.fix === "retry" ? "Try again" : "Join queue"}
        variant="brand"
        icon="how_to_reg"
        onPress={() => void doJoin()}
        loading={busy}
        disabled={!open}
        accessibilityLabel={`Join ${queue.name} at ${business.name}`}
      />
      <ThemedText
        type="small"
        themeColor="inkMuted"
        accessibilityLiveRegion="polite"
      >
        {phase === "locating"
          ? "Checking your location…"
          : phase === "joining"
            ? "Joining…"
            : open
              ? "Your location is checked once to confirm you are here. It is not stored."
              : "Joining opens when the queue is open."}
      </ThemedText>
      {myRole ? (
        <ThemedText type="small" themeColor="inkMuted">
          You manage this queue. You can still join it as a customer, for
          example to test it.
        </ThemedText>
      ) : null}
    </Screen>
  );
}
