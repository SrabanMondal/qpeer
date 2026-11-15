import {
  approxDuration,
  type QueueLiveSummary,
  waitRangeAt,
} from "@qpeer/shared";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Badge, Button, Card, Icon } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { formatRupees } from "@/lib/format";
import { payHref } from "@/lib/pay-flow";

/** "about 12 min" / "under a minute" (the shared midpoint rule). */
function aboutText(lowMs: number, highMs: number): string {
  const w = approxDuration(lowMs, highMs);
  return w.startsWith("~") ? `about ${w.slice(1)}` : "under a minute";
}

/**
 * PRI-02 entry on the join screen and the business page: "Buy Priority
 * Pass · ₹X" (signed-in, non-anonymous only; a guest signs in first), or
 * "Sold out" when the daily cap is reached. The honest preview and the
 * rules come on the pay screen, before any payment.
 */
export function PriorityBuyCard({
  queueId,
  feePaise,
  soldOut,
  live,
  now,
}: {
  queueId: string;
  feePaise: number;
  soldOut: boolean;
  live: QueueLiveSummary | null;
  now: number;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const guest = !user || user.isAnonymous;
  const p = live?.priority;
  const range =
    live && live.status !== "closed" && p
      ? waitRangeAt(
          {
            waiting: p.waiting,
            waitLowMs: p.waitLowMs,
            waitHighMs: p.waitHighMs,
            updatedAt: live.updatedAt,
          },
          now,
        )
      : null;
  return (
    <Card>
      <View style={styles.head}>
        <Icon name="bolt" color="primary" />
        <ThemedText type="titleMedium" style={styles.flex}>
          Priority Pass
        </ThemedText>
      </View>
      <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
        {range
          ? `Priority holders wait ${aboutText(range.lowMs, range.highMs)} right now. Buy from anywhere; check in when you arrive.`
          : "Buy from anywhere; check in when you arrive to join the priority lane."}
      </ThemedText>
      {soldOut ? (
        <Badge label="Sold out for today" tone="neutral" />
      ) : guest ? (
        <>
          <Button
            title="Sign in to buy a pass"
            variant="tonal"
            icon="login"
            onPress={() => router.push("/sign-in")}
          />
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            A pass is tied to your account, so it needs a phone or Google
            sign-in.
          </ThemedText>
        </>
      ) : (
        // Tonal: the free "Join queue" is the screen's one filled button.
        <Button
          title={`Buy Priority Pass · ${formatRupees(feePaise)}`}
          variant="tonal"
          icon="bolt"
          onPress={() => router.push(payHref({ kind: "priority", queueId }))}
          needsNetwork
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  flex: { flex: 1 },
});
