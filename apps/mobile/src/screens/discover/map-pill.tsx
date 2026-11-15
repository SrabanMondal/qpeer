import type { MarkerStatus } from "@qpeer/shared";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";

import {
  BOARD_SOLID_FONT_SCALE,
  Radius,
  Spacing,
  Type,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** How a pill is drawn: the board face, the quiet closed pill, or selected. */
export type PillKind = "board" | "paused" | "closed" | "selected";

export function pillKind(status: MarkerStatus, selected: boolean): PillKind {
  if (selected) return "selected";
  return status === "open" ? "board" : status;
}

/** Image id of a pill on the map (one image per kind and label). */
export function pillImageId(kind: PillKind, label: string): string {
  return `pill:${kind}:${label}`;
}

/** The pill text may grow only a little with the phone's text size. */
const MAX_SCALE = 1.3;
const TAIL = 8;

/**
 * A map pill (design guide §1, §3): the token board's face in small. Open
 * (and paused, dimmed) queues are a black `boardBg` pill with the wait in
 * Doto `boardLed`; closed ones a quiet surface pill in Roboto; the selected
 * one keeps the board face with a brass ring and larger LEDs. A tail points
 * at the place. At font scale ≥ 1.3 the LEDs switch to Archivo 800 (the
 * access rule). Drawn by Mapbox as an image, so it has no touch handling.
 */
export function MapPill({ kind, label }: { kind: PillKind; label: string }) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const solid = fontScale >= BOARD_SOLID_FONT_SCALE;
  const onBoard = kind !== "closed";
  const selected = kind === "selected";
  const face = onBoard ? theme.boardBg : theme.surfaceContainerHigh;
  const ring = selected
    ? theme.primary
    : onBoard
      ? theme.boardEdge
      : theme.outlineVariant;
  const ink = !onBoard
    ? theme.onSurfaceVariant
    : kind === "paused"
      ? theme.boardLedDim
      : theme.boardLed;
  // The selected pill's LEDs are the board's row size; the others the
  // 15 sp minimum.
  const board = selected
    ? solid
      ? Type.boardLabelSolid
      : Type.boardLabel
    : solid
      ? Type.boardPillSolid
      : Type.boardPill;
  return (
    <View style={styles.wrap} collapsable={false}>
      <View
        style={[
          styles.pill,
          selected && styles.pillSelected,
          {
            backgroundColor: face,
            borderColor: ring,
            borderWidth: selected ? 3 : 1.5,
          },
        ]}
      >
        <Text
          maxFontSizeMultiplier={MAX_SCALE}
          numberOfLines={1}
          style={[
            onBoard ? board : Type.labelLarge,
            {
              color: ink,
              textShadowColor: onBoard ? theme.boardGlow : undefined,
              textShadowRadius: onBoard ? 6 : 0,
            },
          ]}
        >
          {onBoard ? label.toUpperCase() : label}
        </Text>
      </View>
      <View
        style={[
          styles.tail,
          {
            backgroundColor: face,
            borderColor: ring,
            borderRightWidth: selected ? 3 : 1.5,
            borderBottomWidth: selected ? 3 : 1.5,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingBottom: TAIL / 2 },
  pill: {
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.twoHalf,
    paddingVertical: Spacing.one,
    minHeight: 32,
    justifyContent: "center",
    zIndex: 1,
  },
  pillSelected: {
    paddingHorizontal: Spacing.three,
    minHeight: 40,
  },
  tail: {
    width: TAIL * 1.4,
    height: TAIL * 1.4,
    marginTop: -TAIL,
    transform: [{ rotate: "45deg" }],
  },
});
