import { MaterialSymbols_400Regular_Filled } from "@expo-google-fonts/material-symbols/400Regular_Filled";
import { type AndroidSymbol, SymbolView } from "expo-symbols";
import type { ColorValue } from "react-native";

import type { ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type IconName = AndroidSymbol;

/** Family name of the filled Material Symbols font (also preloaded at start). */
export const FILLED_SYMBOLS_FONT = "MaterialSymbols_400Regular_Filled";

/** expo-symbols' Android weight object for the filled style. */
const FILLED = {
  ios: "regular",
  android: {
    name: FILLED_SYMBOLS_FONT,
    font: MaterialSymbols_400Regular_Filled,
  },
} as const;

/**
 * A Material Symbol, outlined by default; `filled` only for the selected
 * state (the selected tab). On Android expo-symbols draws it with a bundled
 * font through expo-font (JS only, no native rebuild). Decorative: hidden
 * from screen readers, so always pair it with a text label.
 */
export function Icon({
  name,
  size = 24,
  color = "onSurface",
  colorValue,
  filled = false,
}: {
  name: IconName;
  size?: number;
  color?: ThemeColor;
  /** A colour handed over by a navigator (already a token value), e.g. tab bar tint. */
  colorValue?: ColorValue;
  /** The filled style, for selected state only. */
  filled?: boolean;
}) {
  const theme = useTheme();
  return (
    <SymbolView
      // expo-symbols loads its font once per mount: a style change needs a
      // fresh view.
      key={filled ? "filled" : "outlined"}
      name={{ android: name, web: name }}
      size={size}
      weight={filled ? FILLED : undefined}
      tintColor={colorValue ?? theme[color]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}
