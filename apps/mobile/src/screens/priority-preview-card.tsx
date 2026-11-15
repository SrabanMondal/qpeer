import type { PriorityPreview } from "@qpeer/shared";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Card, InfoRow } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { formatMinutes } from "@/lib/queue-format";

const MINUTE_MS = 60_000;

/**
 * PRI-02 honest preview (design guide §5a "Buy pass preview"): "Priority
 * holders wait about X min · regular wait about Y min · you save about Z
 * min", with the saving as an Archivo figure in `primary`. Waits are durations measured at
 * `at`; `now` is the server-corrected clock.
 */
export function PriorityPreviewCard({
  preview: p,
  now,
}: {
  preview: PriorityPreview;
  now: number;
}) {
  const age = Math.max(0, now - p.at);
  const minutes = (w: { lowMs: number; highMs: number }) =>
    formatMinutes(Math.max(0, ((w.lowMs + w.highMs) / 2 - age) / MINUTE_MS));
  return (
    <Card>
      <ThemedText type="titleMedium">With a Priority Pass</ThemedText>
      {p.priorityWait && p.regularWait ? (
        <>
          <InfoRow
            label="Priority wait"
            value={`~${minutes(p.priorityWait)}`}
          />
          <InfoRow label="Regular wait" value={`~${minutes(p.regularWait)}`} />
          <View style={styles.row}>
            <ThemedText type="bodyLarge" themeColor="onSurfaceVariant">
              You save
            </ThemedText>
            <ThemedText type="figure" themeColor="primary">
              {`~${p.savingMin} min`}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="inkMuted">
            {`Priority holders wait about ${minutes(p.priorityWait)} · regular wait about ${minutes(p.regularWait)} · you save about ${p.savingMin} min. Estimates for right now; they change as people come and go.`}
          </ThemedText>
          {!p.show && !p.soldOut ? (
            <ThemedText type="small" themeColor="warning">
              Right now the priority lane is not much faster than the regular
              line.
            </ThemedText>
          ) : null}
        </>
      ) : (
        <ThemedText type="small" themeColor="inkMuted">
          The queue is closed now, so there is no wait estimate yet. You join
          the priority lane when you check in.
        </ThemedText>
      )}
      <ThemedText type="small" themeColor="inkMuted">
        {`The staff call 1 priority holder for every ${p.perRegular} regular ${p.perRegular === 1 ? "customer" : "customers"}.`}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.one,
  },
});
