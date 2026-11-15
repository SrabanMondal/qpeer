import type { PriorityPreview } from "@qpeer/shared";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Card, Icon, InfoRow } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { formatMinutes } from "@/lib/queue-format";

const MINUTE_MS = 60_000;

/**
 * PRI-02 honest preview (design guide §5a "Buy pass preview"): rows
 * "Priority wait", "Regular wait", "You save" (an Archivo figure in
 * `primary`). Waits are durations measured at `at`; `now` is the
 * server-corrected clock.
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
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            Estimates for right now; they change as people come and go.
          </ThemedText>
          {!p.show && !p.soldOut ? (
            <View style={styles.note}>
              <Icon name="info" size={18} color="primary" />
              <ThemedText
                type="bodyMedium"
                themeColor="onSurface"
                style={styles.flex}
              >
                Right now the priority lane is not much faster than the regular
                line.
              </ThemedText>
            </View>
          ) : null}
        </>
      ) : (
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          The queue is closed now, so there is no wait estimate yet. You join
          the priority lane when you check in.
        </ThemedText>
      )}
      <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
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
  note: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.two },
  flex: { flex: 1 },
});
