/**
 * Design tokens from docs/QPeer_v1_UI_Design_Guide.md §2. Components use only
 * these tokens (no hex values elsewhere, except the QR code's white quiet zone).
 *
 * Colour roles: `brand` (teal) = customer/brand actions, success, mode switch
 * on; `primary` (blue) = operational primary action. Soft colours are tinted
 * backgrounds; in dark mode they are 15–20 % opacity versions.
 */

import "@/global.css";

import { Platform, type TextStyle } from "react-native";

export const Colors = {
  light: {
    brand: "#1E9E7F",
    brandSoft: "#E3F5EF",
    primary: "#2F7FE0",
    primarySoft: "#E6EEF9",
    /** Text and icons on `brand` / `primary` / `header`. */
    onPrimary: "#FFFFFF",
    danger: "#C62828",
    dangerSoft: "#FDE7E7",
    warning: "#E8A317",
    warningSoft: "#FDF3DC",
    ink: "#1B2A41",
    inkMuted: "#5B6472",
    header: "#2E3E55",
    bg: "#F2F4F7",
    card: "#FFFFFF",
    border: "#E2E6EC",
    /** Shadow colour for cards (light mode only). */
    shadow: "#1B2A41",
  },
  dark: {
    brand: "#2BB892",
    brandSoft: "rgba(43, 184, 146, 0.18)",
    primary: "#4A93EC",
    primarySoft: "rgba(74, 147, 236, 0.18)",
    onPrimary: "#FFFFFF",
    danger: "#EF6B6B",
    dangerSoft: "rgba(239, 107, 107, 0.18)",
    warning: "#F0B43A",
    warningSoft: "rgba(240, 180, 58, 0.18)",
    ink: "#EEF2F7",
    inkMuted: "#9AA5B4",
    header: "#16202C",
    bg: "#0F141B",
    card: "#1A222D",
    border: "#2A3441",
    shadow: "#000000",
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type ThemeColors = { [K in ThemeColor]: string };

/** Type scale (§2). Sizes scale with the phone's font setting. */
export const Type = {
  display: { fontSize: 64, lineHeight: 72, fontWeight: "800" },
  title: { fontSize: 26, lineHeight: 32, fontWeight: "700" },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "700" },
  body: { fontSize: 16, lineHeight: 22, fontWeight: "500" },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "600" },
  small: { fontSize: 14, lineHeight: 20, fontWeight: "400" },
} as const satisfies Record<string, TextStyle>;

export type TypeToken = keyof typeof Type;

/** Corner radii (§2): cards 16, buttons 14, inputs 12, pills 999. */
export const Radius = {
  card: 16,
  button: 14,
  input: 12,
  pill: 999,
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

/** Spacing scale (§2: 4, 8, 12, 16, 24, 32). Screen padding 16, card gap 16. */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  twoHalf: 12,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 800;
