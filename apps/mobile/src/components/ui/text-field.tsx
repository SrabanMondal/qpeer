import { StyleSheet, TextInput, type TextInputProps, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type TextFieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  /** Shown in red under the field. */
  error?: string | null;
  /** Shown under the field when there is no error. */
  hint?: string;
};

export function TextField({
  label,
  error,
  hint,
  editable = true,
  ...input
}: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <ThemedText type="label" themeColor="inkMuted">
        {label}
      </ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.inkMuted}
        editable={editable}
        style={[
          styles.input,
          {
            color: theme.ink,
            borderColor: error ? theme.danger : theme.border,
            backgroundColor: editable ? theme.card : theme.bg,
          },
        ]}
        {...input}
      />
      {error ? (
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="inkMuted">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  input: {
    ...Type.body,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
