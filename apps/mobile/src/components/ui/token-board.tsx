import { type ReactNode, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  type TextStyle,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
} from "react-native-reanimated";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";

import {
  BOARD_SOLID_FONT_SCALE,
  FontFamily,
  Radius,
  Spacing,
  Spring,
  Type,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** LED colour of a piece of board text. */
export type BoardTone = "led" | "dim" | "alert";

/** One row of LED text: a label on the left, a value on the right. */
export type BoardRow = {
  left: string;
  right?: string | null;
  leftTone?: BoardTone;
  rightTone?: BoardTone;
  /** The right value can be selected and copied (the check code). */
  rightSelectable?: boolean;
};

type TokenBoardProps = {
  /** The row above the number ("YOUR TOKEN · K7P2", "COME NOW · 4:12"). */
  top: BoardRow;
  /** The big number, already in board form ("014", see `boardNumber`). */
  number: string;
  numberTone?: BoardTone;
  /** The row under the rule ("NOW SERVING · 006"). */
  bottom?: BoardRow | null;
  /** The whole meaning in words, for screen readers (one stop). */
  accessibilityLabel: string;
  /**
   * When this changes to a new non-empty value (after the first render), the
   * LEDs blank and re-light row by row: the one orchestrated moment, used
   * when a ticket is called. Instant with reduced motion.
   */
  relightKey?: string | null;
  /** Announce changes politely (the console's live number). */
  live?: boolean;
};

/** Row delay of the re-light: three rows ≈ 360 ms with the effects spring. */
const RELIGHT_STEP_MS = 120;

/**
 * "014", "006", "P03", "T02": numbers padded to three places, as on the LED
 * boards over clinic counters. Anything else is shown as it is.
 */
export function boardNumber(label: string | null | undefined): string {
  if (!label) return "---";
  const m = /^([A-Z]*)(\d+)$/.exec(label);
  if (!m) return label;
  const [, prefix, digits] = m;
  return prefix + digits.padStart(Math.max(1, 3 - prefix.length), "0");
}

/** "K7P2" → "K 7 P 2", so screen readers spell codes. */
export function spell(code: string): string {
  return code.split("").join(" ");
}

/**
 * The token board (design guide §1, the app's one signature): amber LED
 * text on a black face, a top row, the big number, a rule, a bottom row.
 *
 * - Doto 900 (dot-matrix) only here and on map pills. When the phone's font
 *   scale is ≥ 1.3 the board switches to Archivo 800, which stays readable
 *   when large (access rule).
 * - The board is one accessibility stop with `accessibilityLabel`.
 * - Colours are fixed board tokens, the same in both themes (only the edge
 *   ring changes).
 */
export function TokenBoard({
  top,
  number,
  numberTone = "led",
  bottom,
  accessibilityLabel,
  relightKey,
  live = false,
}: TokenBoardProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const solid = fontScale >= BOARD_SOLID_FONT_SCALE;
  const reduceMotion = useReducedMotion();

  const rows = [useSharedValue(1), useSharedValue(1), useSharedValue(1)];
  const lastKey = useRef(relightKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: shared values are stable refs; only a new key re-lights.
  useEffect(() => {
    const before = lastKey.current;
    lastKey.current = relightKey;
    if (!relightKey || relightKey === before || reduceMotion) return;
    rows.forEach((row, i) => {
      row.set(0);
      row.set(
        withDelay(i * RELIGHT_STEP_MS, withSpring(1, Spring.fastEffects)),
      );
    });
  }, [relightKey, reduceMotion]);

  const tone = (t: BoardTone | undefined): TextStyle => {
    switch (t) {
      case "dim":
        return { color: theme.boardLedDim };
      case "alert":
        return {
          color: theme.boardAlert,
          textShadowColor: theme.boardAlertGlow,
        };
      default:
        return { color: theme.boardLed, textShadowColor: theme.boardGlow };
    }
  };

  const face: TextStyle = solid
    ? { fontFamily: FontFamily.figureHeavy, letterSpacing: 0.5 }
    : {};

  const renderRow = (row: BoardRow) => (
    <View style={styles.row}>
      <Text
        style={[Type.boardLabel, styles.glowSmall, face, tone(row.leftTone)]}
      >
        {row.left}
      </Text>
      {row.right ? (
        <Text
          selectable={row.rightSelectable}
          style={[
            Type.boardLabel,
            styles.glowSmall,
            styles.right,
            face,
            tone(row.rightTone),
          ]}
        >
          {row.right}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion={live ? "polite" : "none"}
      style={[
        styles.board,
        { backgroundColor: theme.boardBg, borderColor: theme.boardEdge },
      ]}
    >
      <DotGrid color={theme.boardDots} />
      <Lit value={rows[0]}>{renderRow(top)}</Lit>
      <Lit value={rows[1]}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1.3}
          style={[
            Type.boardDisplay,
            styles.glowLarge,
            solid && styles.solidNumber,
            tone(numberTone),
          ]}
        >
          {number}
        </Text>
      </Lit>
      {bottom ? (
        <Lit value={rows[2]}>
          <View style={[styles.rule, { backgroundColor: theme.boardRule }]} />
          {renderRow(bottom)}
        </Lit>
      ) : null}
    </View>
  );
}

/** One board row whose LEDs can blank and re-light. */
function Lit({
  value,
  children,
}: {
  value: SharedValue<number>;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => ({ opacity: value.get() }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** The faint LED dot grid behind the text (decoration only). */
function DotGrid({ color }: { color: string }) {
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern
            id="led-dots"
            width={6}
            height={6}
            patternUnits="userSpaceOnUse"
          >
            <Circle cx={3} cy={3} r={1.2} fill={color} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#led-dots)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    borderRadius: Radius.card,
    borderWidth: 3,
    overflow: "hidden",
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.twoHalf,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "baseline",
    columnGap: Spacing.twoHalf,
  },
  right: { textAlign: "right", flexShrink: 1 },
  glowSmall: { textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 6 },
  glowLarge: {
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  solidNumber: {
    fontFamily: FontFamily.figureHeavy,
    letterSpacing: 0,
  },
  rule: {
    height: StyleSheet.hairlineWidth * 2,
    marginVertical: Spacing.twoHalf,
  },
});
