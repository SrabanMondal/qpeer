import {
  Host,
  ModalBottomSheet,
  type ModalBottomSheetRef,
  RNHostView,
} from "@expo/ui/jetpack-compose";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing, withAlpha } from "@/constants/theme";
import { useIsDark, useTheme } from "@/hooks/use-theme";

/** M3 scrim behind a modal sheet: `scrim` at 32 %. */
const SCRIM_ALPHA = 0.32;

/**
 * M3 modal bottom sheet (Jetpack Compose `ModalBottomSheet` from
 * `@expo/ui`, stable API): `surfaceContainerLow`, drag handle, top corners
 * 28, a 32 % scrim. Swipe down, Back or a tap on the scrim closes it. The
 * content is ordinary React Native (our buttons, fields and text), with an
 * optional title (title large) and 16 dp padding.
 *
 * For more detail or actions tied to the screen ("Reserve or skip the
 * line", the ticket code), never for a decision that cannot be undone
 * (that is a dialog).
 */
export function Sheet({
  visible,
  onDismiss,
  title,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const dark = useIsDark();
  const sheetRef = useRef<ModalBottomSheetRef>(null);
  // Stays mounted until the hide animation has finished.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    let cancelled = false;
    const hidden = sheetRef.current?.hide() ?? Promise.resolve();
    void hidden.then(() => {
      if (!cancelled) setMounted(false);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!mounted) return null;

  return (
    <Host
      style={styles.host}
      pointerEvents="none"
      colorScheme={dark ? "dark" : "light"}
    >
      <ModalBottomSheet
        ref={sheetRef}
        onDismissRequest={onDismiss}
        skipPartiallyExpanded
        containerColor={theme.surfaceContainerLow}
        contentColor={theme.onSurface}
        scrimColor={withAlpha(theme.scrim, SCRIM_ALPHA)}
      >
        <RNHostView matchContents={{ vertical: true }}>
          <View style={styles.content}>
            {title ? (
              <ThemedText type="titleLarge" accessibilityRole="header">
                {title}
              </ThemedText>
            ) : null}
            {children}
          </View>
        </RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute" },
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
});
