/**
 * Design tokens: the "Token board" system (docs/QPeer_v1_UI_Design_Guide.md
 * §1–§3, direction B chosen 2026-11-15). Components use only these tokens
 * (no hex values elsewhere, except the QR code's white quiet zone).
 *
 * - Material 3 colour roles, light and dark, generated with the app-ui
 *   skill's `palette.mjs --seed "#E89A00" --neutral "#5E6470"` (output used
 *   verbatim). Brass primary, green tertiary = success, error = destructive.
 * - Board tokens: the amber LED token board, the one black, high-chroma
 *   region of the app (TokenBoard, map pills). Never whole screens.
 * - Old token names (`brand`, `ink`, `card`, `bg`, …) are kept as aliases
 *   mapped onto the new roles, so screens not yet migrated pick up the new
 *   look. They are deprecated: new code uses the role names.
 */

import "@/global.css";

import { Platform, type TextStyle } from "react-native";

/** Fixed board colours, the same in both themes unless noted. */
const board = {
  /** The board's black face. */
  boardBg: "#0B0B0C",
  /** LED digits and labels: 10.8:1 on `boardBg`. */
  boardLed: "#FFB020",
  /** Dimmer LED for the check code and secondary board text: 5.7:1 on `boardBg`. */
  boardLedDim: "#B0832E",
  /** Red LEDs ("COME NOW", the countdown): 5.9:1 on `boardBg`. */
  boardAlert: "#FF4A3D",
  /** Soft glow behind LED text (Android text shadow). */
  boardGlow: "rgba(255, 176, 32, 0.45)",
  boardAlertGlow: "rgba(255, 74, 61, 0.5)",
  /** The faint LED dot grid behind the digits (decoration). */
  boardDots: "rgba(255, 176, 32, 0.07)",
  /** The thin rule between board rows (decoration). */
  boardRule: "#2A2418",
} as const;

const light = {
  // ----- Material 3 roles (palette.mjs, light) -----
  primary: "#825507",
  onPrimary: "#FFFFFF",
  primaryContainer: "#FFDDB6",
  onPrimaryContainer: "#271900",
  secondary: "#715A3F",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#F2E0CD",
  onSecondaryContainer: "#271900",
  tertiary: "#446738",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#D2E9C8",
  onTertiaryContainer: "#0E2000",
  error: "#B4271F",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD3",
  onErrorContainer: "#380C00",
  surface: "#F7F9FF",
  surfaceDim: "#D6DAE3",
  surfaceBright: "#F7F9FF",
  surfaceContainerLowest: "#FFFFFF",
  surfaceContainerLow: "#F1F4F9",
  surfaceContainer: "#EBEEF3",
  surfaceContainerHigh: "#E6E8EE",
  surfaceContainerHighest: "#E0E2E8",
  onSurface: "#181C22",
  surfaceVariant: "#DDE3EE",
  onSurfaceVariant: "#3F4756",
  outline: "#6F7788",
  outlineVariant: "#BEC7D9",
  inverseSurface: "#2D3038",
  inverseOnSurface: "#EEF1F6",
  inversePrimary: "#F6BC70",
  scrim: "#000000",
  shadow: "#000000",
  // ----- Board -----
  ...board,
  /** Inner 3 dp ring of the board. */
  boardEdge: "#26221B",
} as const;

const dark = {
  // ----- Material 3 roles (palette.mjs, dark; its own palette) -----
  primary: "#F6BC70",
  onPrimary: "#442B00",
  primaryContainer: "#633F00",
  onPrimaryContainer: "#FFDDB6",
  secondary: "#DEC2A3",
  onSecondary: "#3F2D14",
  secondaryContainer: "#584329",
  onSecondaryContainer: "#F2E0CD",
  tertiary: "#ABD19B",
  onTertiary: "#15380C",
  tertiaryContainer: "#2C4F22",
  onTertiaryContainer: "#D2E9C8",
  error: "#FFB4A5",
  onError: "#690000",
  errorContainer: "#93000B",
  onErrorContainer: "#FFDAD3",
  surface: "#10131A",
  surfaceDim: "#10131A",
  surfaceBright: "#363940",
  surfaceContainerLowest: "#0A0E16",
  surfaceContainerLow: "#181C22",
  surfaceContainer: "#1C2026",
  surfaceContainerHigh: "#272A31",
  surfaceContainerHighest: "#31353C",
  onSurface: "#E0E2E8",
  surfaceVariant: "#3F4756",
  onSurfaceVariant: "#BEC7D9",
  outline: "#8891A2",
  outlineVariant: "#3F4756",
  inverseSurface: "#E0E2E8",
  inverseOnSurface: "#2D3038",
  inversePrimary: "#825507",
  scrim: "#000000",
  shadow: "#000000",
  // ----- Board -----
  ...board,
  boardEdge: "#31353C",
} as const;

type Roles = { [K in keyof typeof light]: string };

/**
 * @deprecated Old token names from the first design guide, mapped onto the
 * new roles so screens that are not migrated yet still compile and pick up
 * the new look. Use the Material 3 role names in new code.
 */
function aliases(r: Roles) {
  return {
    /** @deprecated use `primary` (filled actions). */
    brand: r.primary,
    /** @deprecated use `primaryContainer`. */
    brandSoft: r.primaryContainer,
    /** @deprecated use `secondaryContainer` (tonal buttons, selected fills). */
    primarySoft: r.secondaryContainer,
    /** @deprecated use `error`. */
    danger: r.error,
    /** @deprecated use `errorContainer`. */
    dangerSoft: r.errorContainer,
    /** @deprecated needs attention (grace, missed, paused): `primary` + an icon or word. */
    warning: r.primary,
    /** @deprecated use `primaryContainer`. */
    warningSoft: r.primaryContainer,
    /** @deprecated use `onSurface`. */
    ink: r.onSurface,
    /** @deprecated use `onSurfaceVariant`. */
    inkMuted: r.onSurfaceVariant,
    /** @deprecated the old dark header band; use `inverseSurface`. */
    header: r.inverseSurface,
    /** @deprecated use `surface`. */
    bg: r.surface,
    /** @deprecated use a surface container role (`surfaceContainer` for cards). */
    card: r.surfaceContainer,
    /** @deprecated use `outlineVariant` (dividers) or `outline` (boundaries). */
    border: r.outlineVariant,
  };
}

export const Colors = {
  light: { ...light, ...aliases(light) },
  dark: { ...dark, ...aliases(dark) },
} as const;

/**
 * Print colours of QR codes: always dark ink on white paper, in both
 * themes, so every scanner reads them (the queue's printable card and the
 * ticket code's quiet zone).
 */
export const PrintColors = {
  ink: "#000000",
  paper: "#FFFFFF",
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type ThemeColors = { [K in ThemeColor]: string };

/**
 * Bundled font families (expo-font config plugin + `useFonts` in the root
 * layout). On Android the family name is the file name. Only these weights
 * are bundled; each file is one weight, so roles using them set
 * `fontWeight: "normal"` (a bold weight on top would be synthesised).
 */
export const FontFamily = {
  /** Doto 900, dot-matrix: only on the board and map pills, never sentences. */
  board: "Doto_900Black",
  /** Archivo 700: figures, screen titles, stat numbers. */
  figure: "Archivo_700Bold",
  /** Archivo 800: the board's large-text fallback, the NEXT label. */
  figureHeavy: "Archivo_800ExtraBold",
} as const;

/** Font scale at which board text switches from Doto to Archivo 800. */
export const BOARD_SOLID_FONT_SCALE = 1.3;

/**
 * Material 3 type roles (Roboto, the system font) plus the board and figure
 * roles. Sizes are sp and scale with the phone's text size.
 */
const roles = {
  displayLarge: { fontSize: 57, lineHeight: 64, letterSpacing: -0.2 },
  displayMedium: { fontSize: 45, lineHeight: 52 },
  displaySmall: { fontSize: 36, lineHeight: 44 },
  headlineLarge: { fontSize: 32, lineHeight: 40 },
  headlineMedium: { fontSize: 28, lineHeight: 36 },
  headlineSmall: { fontSize: 24, lineHeight: 32 },
  titleLarge: { fontSize: 22, lineHeight: 28 },
  titleMedium: {
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0.15,
    fontWeight: "500",
  },
  titleSmall: {
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    fontWeight: "500",
  },
  bodyLarge: { fontSize: 16, lineHeight: 24, letterSpacing: 0.5 },
  bodyMedium: { fontSize: 14, lineHeight: 20, letterSpacing: 0.2 },
  bodySmall: { fontSize: 12, lineHeight: 16, letterSpacing: 0.4 },
  labelLarge: {
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
    fontWeight: "500",
  },
  labelMedium: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.5,
    fontWeight: "500",
  },
  labelSmall: {
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.5,
    fontWeight: "500",
  },

  // ----- QPeer roles -----
  /** The board's big number (Doto 900). */
  boardDisplay: {
    fontFamily: FontFamily.board,
    fontWeight: "normal",
    fontSize: 104,
    lineHeight: 112,
    letterSpacing: 2,
    fontVariant: ["tabular-nums"],
  },
  /** Board rows ("YOUR TOKEN", "NOW SERVING 006 → C2"). Minimum 15 sp. */
  boardLabel: {
    fontFamily: FontFamily.board,
    fontWeight: "normal",
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: 1,
    fontVariant: ["tabular-nums"],
  },
  /**
   * Access rule: at font scale ≥ 1.3 the board switches to these solid
   * Archivo 800 faces (dot-matrix gets hard to read when large).
   */
  boardDisplaySolid: {
    fontFamily: FontFamily.figureHeavy,
    fontWeight: "normal",
    fontSize: 104,
    lineHeight: 112,
    letterSpacing: 0,
    fontVariant: ["tabular-nums"],
  },
  boardLabelSolid: {
    fontFamily: FontFamily.figureHeavy,
    fontWeight: "normal",
    fontSize: 17,
    lineHeight: 24,
    letterSpacing: 0.5,
    fontVariant: ["tabular-nums"],
  },
  /** Figures next to the board, stat numbers (Archivo 700). */
  figure: {
    fontFamily: FontFamily.figure,
    fontWeight: "normal",
    fontSize: 22,
    lineHeight: 28,
    fontVariant: ["tabular-nums"],
  },
  /** Screen titles in the top app bar (Archivo 700, title large size). */
  appTitle: {
    fontFamily: FontFamily.figure,
    fontWeight: "normal",
    fontSize: 22,
    lineHeight: 28,
  },
  /** The NEXT label (Archivo 800). */
  nextLabel: {
    fontFamily: FontFamily.figureHeavy,
    fontWeight: "normal",
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: 2,
  },
} as const satisfies Record<string, TextStyle>;

/**
 * @deprecated Old type tokens, mapped onto Material 3 roles so screens keep
 * working until phase 2 migrates them.
 */
const legacyType = {
  /** @deprecated big numbers: use the TokenBoard or `figure`. */
  display: {
    fontFamily: FontFamily.figureHeavy,
    fontWeight: "normal",
    fontSize: 57,
    lineHeight: 64,
    fontVariant: ["tabular-nums"],
  },
  /** @deprecated use `headlineSmall`. */
  title: { ...roles.headlineSmall, fontWeight: "500" },
  /** @deprecated use `titleMedium` (this is its emphasized form). */
  heading: { ...roles.titleMedium, fontWeight: "700" },
  /** @deprecated use `bodyLarge`. */
  body: roles.bodyLarge,
  /** @deprecated use `labelLarge`. */
  label: roles.labelLarge,
  /** @deprecated use `bodyMedium`. */
  small: roles.bodyMedium,
} as const satisfies Record<string, TextStyle>;

export const Type = { ...roles, ...legacyType } as const;

export type TypeToken = keyof typeof Type;

/**
 * Corner radius scale (M3): xs 4 / sm 8 / md 12 / lg 16 / xl 28 / full.
 * Cards and the board 16, buttons full, chips 8, outlined inputs 12.
 */
export const Radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 28,
  full: 999,
  /** Cards and the board. */
  card: 16,
  /** Chips (filter, assist, input). */
  chip: 8,
  /** Outlined text fields. */
  input: 12,
  /** @deprecated buttons are full-round: use `full`. */
  button: 999,
  /** @deprecated use `full`. */
  pill: 999,
} as const;

/**
 * Material 3 Standard springs in the physics form (mass 1,
 * damping = 2 × ratio × √stiffness). Effects springs never bounce.
 */
export const Spring = {
  fastSpatial: { mass: 1, stiffness: 1400, damping: 67.3 },
  defaultSpatial: { mass: 1, stiffness: 700, damping: 47.6 },
  slowSpatial: { mass: 1, stiffness: 300, damping: 31.2 },
  fastEffects: { mass: 1, stiffness: 3800, damping: 123.3 },
  defaultEffects: { mass: 1, stiffness: 1600, damping: 80 },
  slowEffects: { mass: 1, stiffness: 800, damping: 56.6 },
} as const;

/**
 * Shadows only for things that float (snackbar, the floating Undo bar,
 * FAB, sheets): M3 elevation level 3 as a `boxShadow`. Everything else gets
 * depth from the tonal surface containers.
 */
export const Elevation = {
  level3:
    "0px 1px 3px 0px rgba(0, 0, 0, 0.3), 0px 4px 8px 3px rgba(0, 0, 0, 0.15)",
} as const;

/** Pressed state layer: the content colour at 10 % (M3), via `android_ripple`. */
export const RIPPLE_ALPHA = 0.1;

/** M3 disabled look: container onSurface at 10 %, content onSurface at 38 %. */
export const DISABLED_CONTAINER_ALPHA = 0.1;
export const DISABLED_CONTENT_ALPHA = 0.38;

/** A `#RRGGBB` token at an opacity, as `rgba(…)` (for state layers). */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

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

/** Spacing scale: 4, 8, 12, 16, 24, 32. Screen padding 16, group gap 16–24. */
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
