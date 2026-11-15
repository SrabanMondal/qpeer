import type { TokenView } from "@qpeer/shared";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";

import { ProblemCard } from "@/components/problem-card";
import { ThemedText } from "@/components/themed-text";
import { Button, Icon } from "@/components/ui";
import { Radius, RIPPLE_ALPHA, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useLocationCheck } from "@/lib/api";
import { formatRupees } from "@/lib/format";
import {
  type JoinProblem,
  joinErrorView,
  locationProblemView,
} from "@/lib/join-errors";
import { readJoinLocation, turnOnLocation } from "@/lib/join-location";
import { OFFLINE_ACTION_TEXT, useOffline } from "@/lib/network";
import { formatClock, formatDateTime, ticketTitle } from "@/lib/queue-format";

type GpsPhase = "idle" | "locating" | "sending";

/**
 * The walk-in GPS check for a ticket (same flow and texts as joining,
 * JON-05/06): Priority Pass check-in (PRI-03) or "I'm here" (QUE-23). The
 * reading goes straight into the request; it is never stored or logged.
 */
function useGpsAction(
  tokenId: string,
  action: "checkin" | "rejoin",
  onDone: (t: TokenView) => void,
) {
  const check = useLocationCheck(tokenId, action);
  const [phase, setPhase] = useState<GpsPhase>("idle");
  const [problem, setProblem] = useState<JoinProblem | null>(null);

  const run = async () => {
    if (phase !== "idle") return;
    setProblem(null);
    setPhase("locating");
    try {
      const loc = await readJoinLocation();
      if (!loc.ok) {
        setProblem(locationProblemView(loc.problem));
        return;
      }
      setPhase("sending");
      const { lat, lng, accuracyM, mocked } = loc.body;
      onDone(await check.mutateAsync({ lat, lng, accuracyM, mocked }));
    } catch (e) {
      setProblem(joinErrorView(e, action));
    } finally {
      setPhase("idle");
    }
  };

  const fix = async (p: JoinProblem) => {
    if (p.fix === "open_settings") await Linking.openSettings();
    else if (p.fix === "turn_on_location") {
      if (await turnOnLocation()) await run();
    }
  };

  return { phase, problem, run, fix };
}

function GpsStatus({ phase, idleText }: { phase: GpsPhase; idleText: string }) {
  const offline = useOffline();
  return (
    <ThemedText
      type="bodySmall"
      themeColor="onSurfaceVariant"
      accessibilityLiveRegion="polite"
    >
      {phase === "locating"
        ? "Checking your location…"
        : phase === "sending"
          ? "Confirming…"
          : offline
            ? OFFLINE_ACTION_TEXT
            : idleText}
    </ThemedText>
  );
}

/** Title line of a ticket state block: an icon and a title large. */
function StateTitle({
  icon,
  title,
}: {
  icon: "schedule" | "bolt";
  title: string;
}) {
  return (
    <View style={styles.headline}>
      <Icon name={icon} size={24} color="primary" />
      <ThemedText type="titleLarge" accessibilityRole="header">
        {title}
      </ThemedText>
    </View>
  );
}

/**
 * MISSED (QUE-22/23, design guide §5a): "You missed your turn. When you're
 * here, tap I'm here to rejoin." One rejoin, with a GPS check; after the
 * late window the rejoin goes to the end of the line. "I'm here" is the
 * state's one primary action.
 */
export function MissedCard({
  t,
  now,
  onRejoined,
}: {
  t: TokenView;
  now: number;
  onRejoined: (t: TokenView) => void;
}) {
  const offline = useOffline();
  const gps = useGpsAction(t.id, "rejoin", onRejoined);
  const canRejoin = t.rejoinAvailable !== false;
  const until = t.rejoinUntil ?? null;
  const late = until !== null && now > until;
  return (
    <>
      <View style={styles.block}>
        <StateTitle icon="schedule" title="You missed your turn" />
        {canRejoin ? (
          <>
            <ThemedText type="bodyLarge">
              When you're here, tap I'm here to rejoin.
            </ThemedText>
            <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
              {until === null
                ? "You can rejoin once. You go back in a little behind the front."
                : late
                  ? "You'll rejoin at the end of the line."
                  : `Tap before ${formatClock(until)} to go back in a little behind the front. After that you rejoin at the end of the line. You can rejoin once.`}
            </ThemedText>
            <Button
              title="I'm here"
              size="large"
              icon="where_to_vote"
              loading={gps.phase !== "idle"}
              disabled={offline}
              onPress={() => void gps.run()}
              accessibilityLabel="I'm here: check my location and rejoin the queue"
            />
            <GpsStatus
              phase={gps.phase}
              idleText="Your location is checked once to confirm you are here. It is not stored."
            />
          </>
        ) : (
          <ThemedText type="bodyLarge">
            {t.rejoined
              ? "This ticket already rejoined once, so it can't rejoin again. Ask the staff if you need help."
              : "The queue is closed, so this ticket can't rejoin. You can join again when it opens."}
          </ThemedText>
        )}
      </View>
      {gps.problem ? (
        <ProblemCard problem={gps.problem} onFix={(p) => void gps.fix(p)} />
      ) : null}
    </>
  );
}

/**
 * BOOKED pass (PRI-03, design guide §5a): "Priority Pass · booked", valid
 * until, one big "Check in" (GPS, the primary action), an outlined Cancel
 * with the refund.
 */
export function BookedCard({
  t,
  onCheckedIn,
  onCancel,
  cancelling,
}: {
  t: TokenView;
  onCheckedIn: (t: TokenView) => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const offline = useOffline();
  const gps = useGpsAction(t.id, "checkin", onCheckedIn);
  const closed = t.queueStatus === "closed";
  const paused = t.queueStatus === "paused";
  const pct = t.cancelRefundPct ?? null;
  return (
    <>
      <View style={styles.block}>
        <StateTitle icon="bolt" title="Priority Pass · booked" />
        {t.validUntil ? (
          <ThemedText type="bodyLarge">{`Valid until ${formatDateTime(t.validUntil)}`}</ThemedText>
        ) : null}
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          You are not in the line yet. At the business, tap Check in: you then
          join the priority lane and get your P number.
        </ThemedText>
        <Button
          title="Check in"
          size="large"
          icon="where_to_vote"
          loading={gps.phase !== "idle"}
          disabled={offline || closed || paused}
          onPress={() => void gps.run()}
          accessibilityLabel="Check in: check my location and join the priority lane"
        />
        <GpsStatus
          phase={gps.phase}
          idleText={
            closed
              ? "Check-in opens when the queue opens."
              : paused
                ? "The queue is paused. Check in when it resumes."
                : "Your location is checked once to confirm you are here. It is not stored."
          }
        />
        <Button
          title={
            pct !== null && pct > 0
              ? `Cancel pass · ${pct}% back`
              : "Cancel pass · no refund"
          }
          variant="outlined"
          icon="close"
          loading={cancelling}
          disabled={offline}
          onPress={onCancel}
        />
      </View>
      {gps.problem ? (
        <ProblemCard problem={gps.problem} onFix={(p) => void gps.fix(p)} />
      ) : null}
    </>
  );
}

/**
 * PRI-05 / C2: "Skip ahead · about N min faster" as a tonal row with the
 * price in a ₹ chip (the mock-up's row), only when the server says
 * `upgrade.show` (never "save ~0 min"; hidden under the threshold). The
 * whole row is one button.
 */
export function SkipAheadCard({
  t,
  onPress,
}: {
  t: TokenView;
  onPress: () => void;
}) {
  const theme = useTheme();
  const u = t.upgrade;
  if (!u?.show || u.savingMin <= 0) return null;
  const price = formatRupees(u.pricePaise);
  // The ticket screen shows this row only while online (it needs the server).
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Skip ahead for ${price}, about ${u.savingMin} minutes faster`}
      android_ripple={{ color: theme.onPrimaryContainer, alpha: RIPPLE_ALPHA }}
      style={[styles.skip, { backgroundColor: theme.primaryContainer }]}
    >
      <View style={styles.flex}>
        <ThemedText type="bodyLarge" themeColor="onPrimaryContainer">
          {`Skip ahead · about ${u.savingMin} min faster`}
        </ThemedText>
        <ThemedText type="bodySmall" themeColor="onPrimaryContainer">
          {`Your ticket ${ticketTitle(t)} moves to the priority lane and keeps its number.`}
        </ThemedText>
      </View>
      <View style={[styles.chip, { backgroundColor: theme.primary }]}>
        <ThemedText type="labelLarge" themeColor="onPrimary">
          {price}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.twoHalf },
  headline: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  flex: { flex: 1, gap: Spacing.half },
  skip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.twoHalf,
    minHeight: 64,
    paddingVertical: Spacing.twoHalf,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.twoHalf,
    borderRadius: Radius.card,
    overflow: "hidden",
  },
  chip: {
    minHeight: 36,
    minWidth: 56,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
