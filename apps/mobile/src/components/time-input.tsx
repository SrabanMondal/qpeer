import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { formatTime12 } from "@/lib/format";

const STEP_MIN = 30;
const LAST_MIN = 23 * 60 + 59;

function toMinutes(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function fromMinutes(total: number): string {
  const clamped = Math.max(0, Math.min(LAST_MIN, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Turns loose typing into "HH:MM": "9" → "09:00", "930" → "09:30",
 * "9:5" → "09:05", "1730" → "17:30". Returns the input unchanged when it
 * cannot be read, so validation can flag it.
 */
export function normalizeTime(text: string): string {
  const t = text.trim().replace(/[.\s]/g, ":");
  let h: number;
  let m: number;
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (/^\d{1,2}$/.test(t)) {
    h = Number(t);
    m = 0;
  } else if (/^\d{3,4}$/.test(t)) {
    h = Number(t.slice(0, -2));
    m = Number(t.slice(-2));
  } else {
    return text;
  }
  if (h > 23 || m > 59) return text;
  return fromMinutes(h * 60 + m);
}

/**
 * A 24-hour time field: type "HH:MM" or step by 30 minutes with − / +.
 * No native date picker needed.
 */
export function TimeInput({
  label,
  value,
  onChange,
  invalid = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  const theme = useTheme();

  const step = (delta: number) => {
    const current = toMinutes(normalizeTime(value));
    if (current === null) {
      onChange(delta > 0 ? "09:00" : "18:00");
      return;
    }
    // Snap to the 30-minute grid first, then step.
    const snapped =
      delta > 0
        ? Math.floor(current / STEP_MIN) * STEP_MIN + STEP_MIN
        : Math.ceil(current / STEP_MIN) * STEP_MIN - STEP_MIN;
    onChange(fromMinutes(snapped));
  };

  const stepButton = (delta: number, symbol: string, spoken: string) => (
    <Pressable
      onPress={() => step(delta)}
      accessibilityRole="button"
      accessibilityLabel={`${spoken} ${label}`}
      style={({ pressed }) => [
        styles.step,
        { backgroundColor: theme.primarySoft },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.stepText, { color: theme.ink }]}>{symbol}</Text>
    </Pressable>
  );

  const normalized = normalizeTime(value);
  return (
    <View style={styles.wrap}>
      <ThemedText type="label" themeColor="inkMuted">
        {label}
        {toMinutes(normalized) !== null ? ` · ${formatTime12(normalized)}` : ""}
      </ThemedText>
      <View style={styles.row}>
        {stepButton(-STEP_MIN, "−", "30 minutes earlier,")}
        <TextInput
          value={value}
          onChangeText={onChange}
          onBlur={() => onChange(normalizeTime(value))}
          accessibilityLabel={`${label}, 24-hour time`}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          placeholder="HH:MM"
          placeholderTextColor={theme.inkMuted}
          style={[
            styles.input,
            {
              color: theme.ink,
              backgroundColor: theme.card,
              borderColor: invalid ? theme.danger : theme.border,
            },
          ]}
        />
        {stepButton(STEP_MIN, "+", "30 minutes later,")}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Two fit side by side on most phones; they wrap on narrow or large-font screens.
  wrap: { gap: Spacing.half, flexGrow: 1, flexBasis: 160 },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.one },
  step: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: Radius.input,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { ...Type.heading },
  pressed: { opacity: 0.6 },
  input: {
    ...Type.body,
    flex: 1,
    minHeight: 44,
    minWidth: 64,
    borderWidth: 1,
    borderRadius: Radius.input,
    textAlign: "center",
    paddingHorizontal: Spacing.one,
  },
});
