import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";

import { Spacing } from "@/constants/theme";

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const inactive = disabled || loading;
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.secondary,
        (pressed || inactive) && styles.dim,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? "#ffffff" : "#208AEF"} />
      ) : (
        <Text style={[styles.text, primary ? styles.textOn : styles.textOff]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: "#208AEF" },
  secondary: { borderWidth: 1, borderColor: "#208AEF" },
  dim: { opacity: 0.6 },
  text: { fontSize: 16, fontWeight: "600" },
  textOn: { color: "#ffffff" },
  textOff: { color: "#208AEF" },
});
