/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors, type ThemeColors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}

/** The colour tokens for the current light/dark scheme. */
export function useTheme(): ThemeColors {
  return useIsDark() ? Colors.dark : Colors.light;
}
