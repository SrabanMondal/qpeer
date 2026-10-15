import { type AndroidSymbol, SymbolView } from "expo-symbols";
import type { ColorValue } from "react-native";

import type { ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type IconName = AndroidSymbol;

/**
 * A Material Symbol. On Android expo-symbols draws it with a bundled font
 * through expo-font (JS only, no native rebuild). Decorative: hidden from
 * screen readers, so always pair it with a text label.
 */
export function Icon({
  name,
  size = 24,
  color = "ink",
  colorValue,
}: {
  name: IconName;
  size?: number;
  color?: ThemeColor;
  /** A colour handed over by a navigator (already a token value), e.g. tab bar tint. */
  colorValue?: ColorValue;
}) {
  const theme = useTheme();
  return (
    <SymbolView
      name={{ android: name, web: name }}
      size={size}
      tintColor={colorValue ?? theme[color]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}
