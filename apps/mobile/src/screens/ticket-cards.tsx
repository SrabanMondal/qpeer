import type { TokenView } from "@qpeer/shared";
import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import { ProblemCard } from "@/components/problem-card";
import { ThemedText } from "@/components/themed-text";
import { Button, Card, Icon } from "@/components/ui";
import { Spacing } from "@/constants/theme";
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
import {
  formatClock,
  formatCountdown,
  formatDateTime,
  ticketTitle,
} from "@/lib/queue-format";

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
      type="small"
      themeColor="inkMuted"
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

/**
 * GRACE hero (R3, design guide §5a): "Come now — m:ss left" in display size,
 * ticking every second on the server-corrected clock, "Counter N" under it.
 */
export function GraceCard({ t, now }: { t: TokenView; now: number }) {
  const theme = useTheme();
  const ends = t.graceEndsAt ?? t.graceUntil;
  const left = ends !== null ? ends - now : 0;
  return (
    <Card style={[styles.hero, { backgroundColor: theme.warningSoft }]}>
      <View style={styles.headline}>
        <Icon name="directions_run" size={28} color="warning" />
        <ThemedText type="heading">You were called — come now</ThemedText>
      </View>
      <ThemedText
        type="display"
        numberOfLines={2}
        adjustsFontSizeToFit
        accessibilityLiveRegion="polite"
      >
        {left > 0
          ? `Come now — ${formatCountdown(left)} left`
          : "Come to the counter now"}
      </ThemedText>
      {t.counter !== null ? (
        <ThemedText type="heading">{`Counter ${t.counter}`}</ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="inkMuted">
        {`Tell the staff your number (#${t.label}${t.checkCode ? ` · ${t.checkCode}` : ""}). If the time runs out your turn is missed; you can then rejoin once with I'm here.`}
      </ThemedText>
    </Card>
  );
}

/**
 * MISSED (QUE-22/23, design guide §5a): "You missed your turn. When you're
 * here, tap I'm here to rejoin." One rejoin, with a GPS check; after the
 * late window the rejoin goes to the end of the line.
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
  const theme = useTheme();
  const offline = useOffline();
  const gps = useGpsAction(t.id, "rejoin", onRejoined);
  const canRejoin = t.rejoinAvailable !== false;
  const until = t.rejoinUntil ?? null;
  const late = until !== null && now > until;
  return (
    <>
      <Card style={[styles.hero, { backgroundColor: theme.warningSoft }]}>
        <View style={styles.headline}>
          <Icon name="schedule" size={28} color="warning" />
          <ThemedText type="title">You missed your turn</ThemedText>
        </View>
        {canRejoin ? (
          <>
            <ThemedText type="body">
              When you're here, tap I'm here to rejoin.
            </ThemedText>
            <ThemedText type="small" themeColor="inkMuted">
              {until === null
                ? "You can rejoin once. You go back in a little behind the front."
                : late
                  ? "You'll rejoin at the end of the line."
                  : `Tap before ${formatClock(until)} to go back in a little behind the front. After that you rejoin at the end of the line. You can rejoin once.`}
            </ThemedText>
            <Button
              title="I'm here"
              variant="brand"
              icon="where_to_vote"
              loading={gps.phase !== "idle"}
              disabled={offline}
              onPress={() => void gps.run()}
              style={styles.big}
              accessibilityLabel="I'm here: check my location and rejoin the queue"
            />
            <GpsStatus
              phase={gps.phase}
              idleText="Your location is checked once to confirm you are here. It is not stored."
            />
          </>
        ) : (
          <ThemedText type="body">
            {t.rejoined
              ? "This ticket already rejoined once, so it can't rejoin again. Ask the staff if you need help."
              : "The queue is closed, so this ticket can't rejoin. You can join again when it opens."}
          </ThemedText>
        )}
      </Card>
      {gps.problem ? (
        <ProblemCard problem={gps.problem} onFix={(p) => void gps.fix(p)} />
      ) : null}
    </>
  );
}

/**
 * BOOKED pass (PRI-03, design guide §5a): "Priority Pass · booked", valid
 * until, one big "Check in" (GPS), small outline Cancel with the refund.
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
      <Card>
        <View style={styles.headline}>
          <Icon name="bolt" size={28} color="brand" />
          <ThemedText type="title">Priority Pass · booked</ThemedText>
        </View>
        <ThemedText type="heading" themeColor="inkMuted">
          {`${t.businessName} · ${t.queueName}`}
        </ThemedText>
        {t.validUntil ? (
          <ThemedText type="body">{`Valid until ${formatDateTime(t.validUntil)}`}</ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="inkMuted">
          You are not in the line yet. At the business, tap Check in: you then
          join the priority lane and get your P number.
        </ThemedText>
        <Button
          title="Check in"
          variant="brand"
          icon="where_to_vote"
          loading={gps.phase !== "idle"}
          disabled={offline || closed || paused}
          onPress={() => void gps.run()}
          style={styles.big}
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
          variant="outline"
          icon="close"
          loading={cancelling}
          disabled={offline}
          onPress={onCancel}
        />
      </Card>
      {gps.problem ? (
        <ProblemCard problem={gps.problem} onFix={(p) => void gps.fix(p)} />
      ) : null}
    </>
  );
}

/**
 * PRI-05 / C2: "Skip ahead for ₹X · about N min faster", only when the server
 * says `upgrade.show` (never "save ~0 min"; hidden under the threshold).
 */
export function SkipAheadCard({
  t,
  onPress,
}: {
  t: TokenView;
  onPress: () => void;
}) {
  const u = t.upgrade;
  if (!u?.show || u.savingMin <= 0) return null;
  return (
    <Card>
      <View style={styles.headline}>
        <Icon name="fast_forward" size={24} color="brand" />
        <ThemedText type="heading" style={styles.flex}>
          {`Skip ahead for ${formatRupees(u.pricePaise)} · about ${u.savingMin} min faster`}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="inkMuted">
        {`Your ticket ${ticketTitle(t)} moves to the priority lane and keeps its number.`}
      </ThemedText>
      <Button
        title={`Skip ahead · ${formatRupees(u.pricePaise)}`}
        variant="brand"
        icon="fast_forward"
        onPress={onPress}
        needsNetwork
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { gap: Spacing.two },
  headline: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  big: { minHeight: 64 },
  flex: { flex: 1 },
});
