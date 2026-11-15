import type { AnalyticsDay, PeakHours } from "@qpeer/shared";
import { hourLabel, WEEKDAY_SHORT } from "@qpeer/shared";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { BarChart, LineChart } from "react-native-gifted-charts";
import { ThemedText } from "@/components/themed-text";
import { Card } from "@/components/ui";
import { Radius, Spacing, Type, withAlpha } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { dayLabel, peakRowLabel } from "@/lib/insights-format";

/** Room taken by the screen and card padding plus the y axis. */
const CHROME = Spacing.three * 4 + 36;

function useChartWidth() {
  const { width } = useWindowDimensions();
  return Math.max(200, Math.min(width, 800) - CHROME);
}

/** Label every day for a week, every 7th day for 4 weeks. */
const showLabel = (i: number, n: number) => n <= 7 || i % 7 === 0;

/** INS-03: people served per day (bars) and average wait per day (line). */
export function TrendCharts({ days }: { days: AnalyticsDay[] }) {
  const theme = useTheme();
  const width = useChartWidth();
  const n = days.length;
  const slot = width / n;
  const barWidth = Math.max(4, Math.floor(slot * 0.6));
  // Axis text in the label small role; lines in the outline roles.
  const axis = {
    yAxisTextStyle: { ...Type.labelSmall, color: theme.onSurfaceVariant },
    xAxisLabelTextStyle: { ...Type.labelSmall, color: theme.onSurfaceVariant },
    xAxisColor: theme.outline,
    yAxisColor: theme.outline,
    rulesColor: theme.outlineVariant,
    noOfSections: 4,
    height: 150,
  };
  const served = days.map((d, i) => ({
    value: d.served,
    label: showLabel(i, n) ? dayLabel(d) : "",
  }));
  const waits = days.flatMap((d, i) =>
    d.avgWaitMs === null
      ? []
      : [
          {
            value: Math.round(d.avgWaitMs / 60_000),
            label: showLabel(i, n) ? dayLabel(d) : "",
          },
        ],
  );
  const total = days.reduce((s, d) => s + d.served, 0);
  return (
    <>
      <Card>
        <ThemedText type="titleMedium">People served per day</ThemedText>
        <View
          accessible
          accessibilityLabel={`People served per day: ${total} in ${n} days, most on one day ${Math.max(0, ...days.map((d) => d.served))}`}
        >
          <BarChart
            data={served}
            width={width}
            barWidth={barWidth}
            spacing={Math.max(2, slot - barWidth)}
            initialSpacing={Math.max(2, (slot - barWidth) / 2)}
            frontColor={theme.primary}
            barBorderRadius={Radius.xs}
            disableScroll
            {...axis}
          />
        </View>
      </Card>
      <Card>
        <ThemedText type="titleMedium">Average wait per day (min)</ThemedText>
        {waits.length < 2 ? (
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            Not enough visits yet to draw a trend.
          </ThemedText>
        ) : (
          <View
            accessible
            accessibilityLabel={`Average wait per day, from ${waits[0]?.value} to ${waits[waits.length - 1]?.value} minutes`}
          >
            <LineChart
              data={waits}
              width={width}
              spacing={Math.max(6, width / Math.max(1, waits.length))}
              initialSpacing={8}
              color={theme.primary}
              dataPointsColor={theme.primary}
              thickness={3}
              curved
              disableScroll
              {...axis}
            />
          </View>
        )}
      </Card>
    </>
  );
}

/** INS-02: weekday × hour heat strip; darker = more people joined. */
export function PeakStrip({ peak }: { peak: PeakHours }) {
  const theme = useTheme();
  const from = peak.fromHour ?? 9;
  const to = peak.toHour ?? 18;
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  return (
    <Card>
      <ThemedText type="titleMedium">Busy hours</ThemedText>
      <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
        Average people joining per hour. Darker is busier.
      </ThemedText>
      <View style={styles.grid}>
        {peak.days.map((row) => (
          <View
            key={row.weekday}
            style={styles.row}
            accessible
            accessibilityLabel={peakRowLabel(row, from, to)}
          >
            <ThemedText
              type="labelMedium"
              themeColor="onSurfaceVariant"
              style={styles.day}
            >
              {WEEKDAY_SHORT[row.weekday]}
            </ThemedText>
            {hours.map((h) => {
              const v = row.avgJoins[h] ?? 0;
              const share = peak.max > 0 ? v / peak.max : 0;
              return (
                <View
                  key={h}
                  style={[
                    styles.cell,
                    {
                      // Primary at 15–100 % strength; empty hours stay a
                      // quiet surface step.
                      backgroundColor:
                        v > 0
                          ? withAlpha(theme.primary, 0.15 + 0.85 * share)
                          : theme.surfaceContainerHighest,
                    },
                  ]}
                />
              );
            })}
          </View>
        ))}
        <View
          style={styles.row}
          importantForAccessibility="no-hide-descendants"
        >
          <View style={styles.day} />
          {hours.map((h) => (
            <View key={h} style={styles.tick}>
              {(h - from) % 3 === 0 ? (
                <ThemedText
                  type="labelSmall"
                  themeColor="onSurfaceVariant"
                  style={styles.tickText}
                  numberOfLines={1}
                >
                  {hourLabel(h).replace(" ", "")}
                </ThemedText>
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 3 },
  row: { flexDirection: "row", alignItems: "center", gap: 3 },
  day: { width: 34 },
  cell: { flex: 1, height: 18, borderRadius: Radius.xs },
  tick: { flex: 1, overflow: "visible" },
  tickText: { width: 40 },
});
