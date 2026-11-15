import { useState } from "react";
import { StyleSheet, TextInput, type TextInputProps, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  DISABLED_CONTENT_ALPHA,
  Radius,
  Spacing,
  Type,
  withAlpha,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type TextFieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  /** Shown in `error` under the field. */
  error?: string | null;
  /** Shown under the field when there is no error. */
  hint?: string;
};

/**
 * M3 outlined text field (the one input style in the app, §3): radius 12,
 * a 1 dp `outline` border that becomes 2 dp `primary` while focused and
 * `error` when invalid. The label stays visible above the field.
 */
export function TextField({
  label,
  error,
  hint,
  editable = true,
  onFocus,
  onBlur,
  ...input
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = !editable
    ? withAlpha(theme.onSurface, 0.12)
    : error
      ? theme.error
      : focused
        ? theme.primary
        : theme.outline;
  return (
    <View style={styles.wrap}>
      <ThemedText
        type="labelLarge"
        themeColor={error ? "error" : focused ? "primary" : "onSurfaceVariant"}
      >
        {label}
      </ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.onSurfaceVariant}
        cursorColor={theme.primary}
        selectionColor={withAlpha(theme.primary, 0.4)}
        editable={editable}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          {
            color: editable
              ? theme.onSurface
              : withAlpha(theme.onSurface, DISABLED_CONTENT_ALPHA),
            borderColor,
            // The focused border is 1 dp wider: take it from the padding so
            // the text does not jump.
            borderWidth: focused || error ? 2 : 1,
            paddingHorizontal: Spacing.three - (focused || error ? 1 : 0),
          },
        ]}
        {...input}
      />
      {error ? (
        <ThemedText type="bodySmall" themeColor="error">
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="bodySmall" themeColor="onSurfaceVariant">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  input: {
    ...Type.bodyLarge,
    minHeight: 56,
    borderRadius: Radius.input,
    paddingVertical: Spacing.two,
  },
});
