import { Text, type TextProps } from "react-native";

import { type ThemeColor, Type, type TypeToken } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type ThemedTextProps = TextProps & {
  /** Type token from the design guide; default `body`. */
  type?: TypeToken;
  /** Colour token; default `ink`. */
  themeColor?: ThemeColor;
};

/** Text in a type-scale token and a colour token. Scales with the phone's font size. */
export function ThemedText({
  style,
  type = "body",
  themeColor,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();
  return (
    <Text
      // The huge display numbers may grow only so far, to stay on screen.
      maxFontSizeMultiplier={type === "display" ? 1.3 : undefined}
      style={[{ color: theme[themeColor ?? "ink"] }, Type[type], style]}
      {...rest}
    />
  );
}
