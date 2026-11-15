import { Text, type TextProps } from "react-native";

import { type ThemeColor, Type, type TypeToken } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type ThemedTextProps = TextProps & {
  /** Type role from the design guide; default `bodyLarge`. */
  type?: TypeToken;
  /** Colour token; default `onSurface`. */
  themeColor?: ThemeColor;
};

/** Huge numbers may grow only so far, to stay on screen (design guide §2). */
const CAPPED: ReadonlySet<TypeToken> = new Set<TypeToken>([
  "displayLarge",
  "displayMedium",
  "boardDisplay",
  "boardDisplaySolid",
]);

/** Text in a type role and a colour token. Scales with the phone's font size. */
export function ThemedText({
  style,
  type = "bodyLarge",
  themeColor,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={CAPPED.has(type) ? 1.3 : undefined}
      style={[{ color: theme[themeColor ?? "onSurface"] }, Type[type], style]}
      {...rest}
    />
  );
}
