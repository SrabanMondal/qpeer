import type {
  AnalyticsResponse,
  BusinessView,
  EarningsResponse,
  Insight,
  InsightsRangeDays,
} from "@qpeer/shared";
import { useRouter } from "expo-router";
import { type ReactNode, useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  ChoiceChips,
  EmptyState,
  ErrorState,
  Icon,
  type IconName,
  InfoRow,
  LoadingState,
  Screen,
  SectionHeader,
} from "@/components/ui";
import { Spacing, type ThemeColor } from "@/constants/theme";
import { useAnalytics, useEarnings, useMyBusinesses } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { kpis, pctText, periodText } from "@/lib/insights-format";
import { useOffline } from "@/lib/network";
import { formatAge } from "@/lib/queue-format";
import { readStored, useStored, writeStored } from "@/lib/storage";
import { PeakStrip, TrendCharts } from "@/screens/insights/charts";
import { EarningsSection } from "@/screens/insights/earnings-section";

/** Saved Insights answers kept on the phone (newest first). */
const MAX_SAVED = 6;

/** Better = tertiary (success), worse = error; the words say which, too. */
const TONE_COLOR: Record<Insight["tone"], ThemeColor> = {
  good: "tertiary",
  bad: "error",
  neutral: "onSurfaceVariant",
};
const KIND_ICON: Record<Insight["kind"], IconName> = {
  busiest: "schedule",
  waits: "hourglass_top",
  no_shows: "person_off",
  volume: "groups",
};

async function saveInsights(
  key: string,
  analytics: AnalyticsResponse,
  earnings: EarningsResponse | null,
) {
  const all = { ...((await readStored("insightsCache")) ?? {}) };
  all[key] = { analytics, earnings, savedAt: Date.now() };
  const keep = Object.entries(all)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, MAX_SAVED);
  await writeStored("insightsCache", Object.fromEntries(keep));
}

function KpiGrid({ data }: { data: AnalyticsResponse }) {
  return (
    <View style={styles.grid}>
      {kpis(data.totals, data.previous, data.rangeDays).map((k) => (
        <Card key={k.key} style={styles.tile}>
          <View
            accessible
            accessibilityLabel={`${k.label}: ${k.value}${k.delta ? `, ${k.delta.text}` : ""}`}
            style={styles.tileInner}
          >
            <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
              {k.label}
            </ThemedText>
            <ThemedText type="figure">{k.value}</ThemedText>
            {k.delta ? (
              <ThemedText
                type="bodySmall"
                themeColor={TONE_COLOR[k.delta.tone]}
              >
                {k.delta.text}
              </ThemedText>
            ) : null}
          </View>
        </Card>
      ))}
    </View>
  );
}

function InsightCards({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return (
      <Card tone="surfaceContainerLow">
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          No clear patterns yet. Tips appear here once there are enough visits
          to be sure.
        </ThemedText>
      </Card>
    );
  }
  return (
    <>
      {insights.map((i) => (
        <Card key={i.kind} style={styles.insight}>
          <Icon name={KIND_ICON[i.kind]} size={24} color={TONE_COLOR[i.tone]} />
          <ThemedText type="bodyLarge" style={styles.flex}>
            {i.text}
          </ThemedText>
        </Card>
      ))}
    </>
  );
}

function Counts({ data }: { data: AnalyticsResponse }) {
  const t = data.totals;
  return (
    <Card>
      <ThemedText type="titleMedium">Who came and who didn't</ThemedText>
      <InfoRow label="Joined" value={String(t.joins)} />
      {/* The tile shows the no-show rate; this is the count. */}
      <InfoRow label="No-shows" value={String(t.noShows)} />
      <InfoRow label="Left the line" value={String(t.left)} />
      <InfoRow label="Cancelled (paid)" value={String(t.cancelled)} />
      <InfoRow label="Gave up waiting" value={pctText(t.abandonmentPct)} />
      <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
        "Gave up" counts people who left or cancelled out of everyone who
        joined. Percentages and averages show once there are 20 visits.
      </ThemedText>
    </Card>
  );
}

/**
 * Business mode → Insights (Step 5, INS-01…08): range 7/28 days, queue
 * filter, KPI tiles, plain-language insights, daily trend, busy-hours strip,
 * and (owners) earnings. Pull to refresh; opens offline with the last view
 * seen for the same choice.
 */
export function InsightsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const offline = useOffline();
  const list = useMyBusinesses();
  const prefs = useStored("insightsPrefs");
  const cache = useStored("insightsCache");

  const businesses: BusinessView[] = list.data?.items ?? [];
  const business =
    businesses.find((b) => b.id === prefs.value?.businessId) ??
    businesses[0] ??
    null;
  const range: InsightsRangeDays = prefs.value?.range ?? 7;
  const queues = business?.queues ?? [];
  const queueId = queues.find((q) => q.id === prefs.value?.queueId)?.id ?? null;
  const isOwner = business?.myRole === "owner";
  const setPrefs = (
    p: Partial<{
      businessId: string;
      range: InsightsRangeDays;
      queueId: string | null;
    }>,
  ) =>
    prefs.set({
      businessId: business?.id ?? null,
      range,
      queueId,
      ...p,
    });

  const analytics = useAnalytics(business?.id ?? null, range, queueId);
  const earnings = useEarnings(business?.id ?? null, range, isOwner);
  const cacheKey = `${user?.uid ?? ""}|${business?.id ?? ""}|${range}|${queueId ?? "all"}`;
  const saved = cache.value?.[cacheKey];

  const freshAnalytics = analytics.data;
  const freshEarnings = earnings.data?.pages[0] ?? null;
  useEffect(() => {
    if (freshAnalytics)
      void saveInsights(cacheKey, freshAnalytics, freshEarnings);
  }, [cacheKey, freshAnalytics, freshEarnings]);

  const data = freshAnalytics ?? saved?.analytics ?? null;
  const usingSaved = !freshAnalytics && !!saved;
  const earningPages =
    earnings.data?.pages ?? (saved?.earnings ? [saved.earnings] : null);

  const refresh = () => {
    void list.refetch();
    void analytics.refetch();
    if (isOwner) void earnings.refetch();
  };

  let body: ReactNode;
  if (list.isPending) {
    body = offline ? (
      <EmptyState
        icon="cloud_off"
        title="Insights need internet"
        message="They show as soon as you're online."
      />
    ) : (
      <LoadingState label="Loading your businesses…" />
    );
  } else if (list.isError) {
    body = (
      <ErrorState
        title="Could not load your businesses"
        error={list.error}
        onRetry={() => list.refetch()}
        retrying={list.isFetching}
      />
    );
  } else if (!business) {
    body = (
      <EmptyState
        icon="storefront"
        title="No business yet"
        message="Create a business and a queue. Busy hours, waits and earnings show here after your first day."
        action={
          <Button
            title="Create a business"
            icon="add"
            onPress={() => router.push("/business/new")}
          />
        }
      />
    );
  } else if (!data) {
    body = analytics.isPending ? (
      offline ? (
        <EmptyState
          icon="cloud_off"
          title="Insights need internet"
          message="They show as soon as you're online."
        />
      ) : (
        <LoadingState label="Working out your insights…" />
      )
    ) : (
      <ErrorState
        title="Could not load insights"
        error={analytics.error}
        onRetry={() => analytics.refetch()}
        retrying={analytics.isFetching}
      />
    );
  } else if (!data.hasData) {
    // INS-08
    body = (
      <EmptyState
        icon="insights"
        title="Insights appear after your first day of queues"
        message="Open a queue and serve a few people. Busy hours, average waits and no-shows show here the next day."
      />
    );
  } else {
    body = (
      <>
        {usingSaved && saved ? (
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            {`Saved ${formatAge(saved.savedAt)}. Pull down to refresh when you're online.`}
          </ThemedText>
        ) : null}
        <KpiGrid data={data} />
        {/* Explains the tiles' changes, right under them. */}
        <ThemedText type="bodySmall" themeColor="onSurfaceVariant">
          {`Changes compare with ${periodText(data.rangeDays)}, up to the same time of day.`}
        </ThemedText>
        <SectionHeader title="What stands out" />
        <InsightCards insights={data.insights} />
        <SectionHeader title="Trends" />
        <TrendCharts days={data.days} />
        <PeakStrip peak={data.peak} />
        <Counts data={data} />
      </>
    );
  }

  return (
    <Screen
      bottomInset={false}
      refreshing={analytics.isRefetching || earnings.isRefetching}
      onRefresh={refresh}
    >
      {businesses.length > 1 ? (
        <ChoiceChips
          label="Business"
          options={businesses.map((b) => ({ value: b.id, label: b.name }))}
          value={business?.id ?? null}
          onChange={(id) => setPrefs({ businessId: id, queueId: null })}
        />
      ) : null}
      {business ? (
        <ChoiceChips
          label="Period"
          options={[
            { value: "7", label: "Last 7 days" },
            { value: "28", label: "Last 28 days" },
          ]}
          value={String(range) as "7" | "28"}
          onChange={(v) => setPrefs({ range: v === "28" ? 28 : 7 })}
        />
      ) : null}
      {queues.length > 1 ? (
        <ChoiceChips
          label="Queue"
          options={[
            { value: "all", label: "All queues" },
            ...queues.map((q) => ({ value: q.id, label: q.name })),
          ]}
          value={queueId ?? "all"}
          onChange={(v) => setPrefs({ queueId: v === "all" ? null : v })}
        />
      ) : null}
      {body}
      {business && isOwner && data?.hasData !== false ? (
        <EarningsSection
          businessId={business.id}
          range={range}
          pages={earningPages}
          isPending={earnings.isPending}
          error={earnings.error}
          onRetry={() => earnings.refetch()}
          retrying={earnings.isFetching}
          hasNextPage={earnings.hasNextPage}
          fetchingNext={earnings.isFetchingNextPage}
          onMore={() => void earnings.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  tile: { flexGrow: 1, flexBasis: "45%" },
  tileInner: { gap: Spacing.half },
  insight: { flexDirection: "row", alignItems: "center", gap: Spacing.twoHalf },
  flex: { flex: 1 },
});
