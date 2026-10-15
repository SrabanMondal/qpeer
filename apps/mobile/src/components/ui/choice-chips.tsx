import { Pressable, StyleSheet, Text, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type Choice<T extends string> = { value: T; label: string };

/** Single-choice picker shown as wrapping pill chips (no native picker needed). */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
  disabled = false,
}: {
  label: string;
  options: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      <ThemedText type="label" themeColor="inkMuted">
        {label}
      </ThemedText>
      <View style={styles.row}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={o.label}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: selected ? theme.primary : theme.border,
                  backgroundColor: selected ? theme.primary : theme.card,
                },
                (pressed || disabled) && styles.dim,
              ]}
            >
              <Text
                style={[
                  styles.text,
                  { color: selected ? theme.onPrimary : theme.ink },
                ]}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  row: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  chip: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    justifyContent: "center",
  },
  dim: { opacity: 0.6 },
  text: { ...Type.body, fontWeight: "600" },
});
