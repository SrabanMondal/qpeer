import {
  type EarningsDay,
  type EarningsEvent,
  type EarningsResponse,
  earningsWeeks,
  splitPaise,
} from "@qpeer/shared";
import { type Href, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  InfoRow,
  LoadingState,
  SectionHeader,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { formatRupees } from "@/lib/format";
import {
  dayLabel,
  eventTitle,
  shortDate,
  signedRupees,
} from "@/lib/insights-format";
import { formatDateTime } from "@/lib/queue-format";

/** Totals per day (7 days) or per week (28 days): your share, with the gross under it. */
function Periods({ days, range }: { days: EarningsDay[]; range: number }) {
  const rows =
    range === 7
      ? days.map((d) => ({ key: d.date, label: dayLabel(d), t: d }))
      : earningsWeeks(days).map((w, i) => ({
          key: String(w.weekStart),
          label: `Week of ${shortDate(days[i * 7]?.date ?? "")}`,
          t: w.totals,
        }));
  return (
    <Card>
      <ThemedText type="titleMedium">
        {range === 7 ? "By day" : "By week"}
      </ThemedText>
      {rows.map((r) => (
        <InfoRow
          key={r.key}
          label={r.label}
          value={
            r.t.captures + r.t.refunds + r.t.forfeits === 0
              ? "—"
              : `${formatRupees(r.t.businessSharePaise)} of ${formatRupees(r.t.netPaise)}`
          }
        />
      ))}
    </Card>
  );
}

function EventRow({ e, pct }: { e: EarningsEvent; pct: number }) {
  return (
    <View style={styles.event}>
      <View style={styles.flex}>
        <ThemedText type="bodyLarge">{eventTitle(e)}</ThemedText>
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          {`${e.queueName} · ${formatDateTime(e.at)}`}
        </ThemedText>
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          {e.kind === "forfeit"
            ? `You keep your ${formatRupees(splitPaise(e.paymentAmountPaise, pct).business)} share`
            : `Your share ${signedRupees(e.businessSharePaise)}`}
        </ThemedText>
      </View>
      {e.kind === "forfeit" ? (
        <Badge label="Kept" tone="warning" />
      ) : (
        <ThemedText
          type="titleMedium"
          themeColor={e.amountPaise < 0 ? "error" : "onSurface"}
          style={styles.amount}
        >
          {signedRupees(e.amountPaise)}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * INS-07 Earnings (owner): share split, totals by day/week, and the money
 * events (captures, refunds, forfeits). The full payment history stays on
 * the Step 4 Payments screen; this links to it.
 */
export function EarningsSection({
  businessId,
  range,
  pages,
  isPending,
  error,
  onRetry,
  retrying,
  hasNextPage,
  fetchingNext,
  onMore,
}: {
  businessId: string;
  range: number;
  pages: EarningsResponse[] | null;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  hasNextPage: boolean;
  fetchingNext: boolean;
  onMore: () => void;
}) {
  const router = useRouter();
  const first = pages?.[0] ?? null;
  const openPayments = () =>
    router.push(`/business/${encodeURIComponent(businessId)}/payments` as Href);

  let body: ReactNode;
  if (!first) {
    body = isPending ? (
      <LoadingState label="Loading earnings…" />
    ) : (
      <ErrorState
        title="Could not load earnings"
        error={error}
        onRetry={onRetry}
        retrying={retrying}
      />
    );
  } else if (!first.hasData) {
    body = (
      <EmptyState
        icon="payments"
        title="No earnings yet"
        message="Paid reservations and Priority Passes show here with your share. Walk-ins pay you directly, outside Qpeer."
      />
    );
  } else {
    const t = first.totals;
    const items = (pages ?? []).flatMap((p) => p.items);
    body = (
      <>
        <Card>
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            Your share
          </ThemedText>
          <ThemedText type="figure" accessibilityRole="text">
            {formatRupees(t.businessSharePaise)}
          </ThemedText>
          <InfoRow label="Fees paid" value={formatRupees(t.capturedPaise)} />
          <InfoRow
            label={`Refunds (${t.refunds})`}
            value={
              t.refundedPaise > 0 ? `−${formatRupees(t.refundedPaise)}` : "₹0"
            }
          />
          <InfoRow
            label="Qpeer share"
            value={formatRupees(t.platformSharePaise)}
          />
          <InfoRow
            label={`No-show fees kept (${t.forfeits})`}
            value={formatRupees(t.forfeitedPaise)}
          />
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {`You keep ${first.businessSharePct}% of each fee, after refunds. Test mode: no real money moves.`}
          </ThemedText>
        </Card>
        <Periods days={first.days} range={range} />
        <Card>
          <ThemedText type="titleMedium">Money in and out</ThemedText>
          {items.length === 0 ? (
            <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
              Nothing in this period.
            </ThemedText>
          ) : (
            items.map((e) => (
              <EventRow key={e.id} e={e} pct={first.businessSharePct} />
            ))
          )}
          {hasNextPage ? (
            <Button
              title="Show older"
              variant="tonal"
              loading={fetchingNext}
              onPress={onMore}
              needsNetwork
            />
          ) : null}
        </Card>
      </>
    );
  }

  return (
    <>
      <SectionHeader title="Earnings" />
      {body}
      <Button
        title="All payments"
        icon="receipt_long"
        variant="outlined"
        onPress={openPayments}
      />
    </>
  );
}

const styles = StyleSheet.create({
  amount: { fontVariant: ["tabular-nums"] },
  event: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  flex: { flex: 1, gap: Spacing.half },
});
