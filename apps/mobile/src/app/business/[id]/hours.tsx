import {
  type DayHours,
  type HoursRange,
  WEEKDAYS,
  type Weekday,
  WeeklyHours,
} from "@qpeer/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { normalizeTime, TimeInput } from "@/components/time-input";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  HeaderButton,
  LoadingState,
  Screen,
  StatusBanner,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useBusiness, useUpdateBusiness } from "@/lib/api";
import { errorText } from "@/lib/error-messages";
import { type FieldErrors, zodFieldErrors } from "@/lib/form";
import {
  formatDay,
  todayInIndia,
  todayText,
  WEEKDAY_LABELS,
} from "@/lib/format";

const MAX_RANGES = 3;
const DEFAULT_RANGE: HoursRange = { from: "09:00", to: "18:00" };

function sortDay(ranges: DayHours): DayHours {
  return ranges
    .map((r) => ({ from: normalizeTime(r.from), to: normalizeTime(r.to) }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

function cleanHours(hours: WeeklyHours): WeeklyHours {
  const out = { ...hours };
  for (const day of WEEKDAYS) out[day] = sortDay(hours[day]);
  return out;
}

/** A follow-on range after the last one, e.g. 18:00 → 19:00–20:00. */
function nextRange(ranges: DayHours): HoursRange {
  const last = ranges[ranges.length - 1];
  if (!last) return DEFAULT_RANGE;
  const [h] = last.to.split(":").map(Number);
  if (!Number.isFinite(h) || h >= 22) return { from: "22:00", to: "23:00" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${pad(h + 1)}:00`, to: `${pad(h + 2)}:00` };
}

/** BIZ-05: opening hours per weekday, up to 3 ranges a day. */
export default function HoursScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const business = useBusiness(id);

  if (!business.data) {
    return (
      <Screen>
        {business.isError ? (
          <ErrorState
            error={business.error}
            onRetry={() => business.refetch()}
            retrying={business.isFetching}
          />
        ) : (
          <LoadingState />
        )}
      </Screen>
    );
  }
  return <HoursEditor businessId={id} initial={business.data.hours} />;
}

function HoursEditor({
  businessId,
  initial,
}: {
  businessId: string;
  initial: WeeklyHours;
}) {
  const router = useRouter();
  const update = useUpdateBusiness(businessId);
  const [hours, setHours] = useState<WeeklyHours>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const today = todayInIndia();

  const setDay = (day: Weekday, ranges: DayHours) => {
    setHours((prev) => ({ ...prev, [day]: ranges }));
    setErrors({});
  };

  const save = async () => {
    const cleaned = cleanHours(hours);
    setHours(cleaned);
    const parsed = WeeklyHours.safeParse(cleaned);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      Alert.alert(
        "Check the hours",
        "Some times are not valid. They are marked in red.",
      );
      return;
    }
    try {
      await update.mutateAsync({ hours: parsed.data });
      router.back();
    } catch (e) {
      Alert.alert("Could not save hours", errorText(e));
    }
  };

  return (
    <Screen>
      <StatusBanner
        tone={hours[today].length > 0 ? "active" : "closed"}
        title={todayText(hours)}
        detail="Type times as HH:MM on the 24-hour clock (17:30 = 5:30 PM), or use − and +. Tap Save hours when done."
      />

      {WEEKDAYS.map((day) => (
        <DayEditor
          key={day}
          day={day}
          isToday={day === today}
          ranges={hours[day]}
          errors={errors}
          onChange={(ranges) => setDay(day, ranges)}
        />
      ))}

      <Button title="Save hours" onPress={save} loading={update.isPending} />
    </Screen>
  );
}

function DayEditor({
  day,
  isToday,
  ranges,
  errors,
  onChange,
}: {
  day: Weekday;
  isToday: boolean;
  ranges: DayHours;
  errors: FieldErrors;
  onChange: (ranges: DayHours) => void;
}) {
  const theme = useTheme();
  const open = ranges.length > 0;
  const label = WEEKDAY_LABELS[day];

  const setRange = (index: number, patch: Partial<HoursRange>) =>
    onChange(ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <Card>
      <View style={styles.dayHeader}>
        <View style={styles.dayTitle}>
          <ThemedText type="heading">{label}</ThemedText>
          <ThemedText type="small" themeColor="inkMuted">
            {open ? formatDay(ranges) : "Closed"}
          </ThemedText>
          {isToday ? (
            <Badge
              label={open ? "Today" : "Closed today"}
              tone={open ? "success" : "warning"}
            />
          ) : null}
        </View>
        <ThemedText type="label" themeColor={open ? "brand" : "inkMuted"}>
          {open ? "Open" : "Closed"}
        </ThemedText>
        <Switch
          value={open}
          onValueChange={(v) => onChange(v ? [DEFAULT_RANGE] : [])}
          accessibilityLabel={`${label} open`}
          trackColor={{ true: theme.brand, false: theme.border }}
          thumbColor={theme.card}
        />
      </View>

      {ranges.map((r, i) => {
        const fromError = errors[`${day}.${i}.from`];
        const toError = errors[`${day}.${i}.to`];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: ranges have no id; order is the identity
          <View key={i} style={styles.range}>
            <View style={styles.rangeRow}>
              <TimeInput
                label={`From (range ${i + 1})`}
                value={r.from}
                onChange={(from) => setRange(i, { from })}
                invalid={Boolean(fromError)}
              />
              <TimeInput
                label={`To (range ${i + 1})`}
                value={r.to}
                onChange={(to) => setRange(i, { to })}
                invalid={Boolean(toError)}
              />
            </View>
            {fromError || toError ? (
              <ThemedText type="small" themeColor="danger">
                {fromError ?? toError}
              </ThemedText>
            ) : null}
            {ranges.length > 1 ? (
              <View style={styles.remove}>
                <HeaderButton
                  title="Remove range"
                  color="danger"
                  accessibilityLabel={`Remove ${label} range ${i + 1}`}
                  onPress={() => onChange(ranges.filter((_, j) => j !== i))}
                />
              </View>
            ) : null}
          </View>
        );
      })}

      {open && ranges.length < MAX_RANGES ? (
        <Button
          title="Add time range"
          variant="secondary"
          accessibilityLabel={`Add a time range on ${label}`}
          onPress={() => onChange([...ranges, nextRange(ranges)])}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  dayHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  dayTitle: { flex: 1, gap: Spacing.half },
  range: { gap: Spacing.one },
  rangeRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  remove: { alignItems: "flex-end" },
});
