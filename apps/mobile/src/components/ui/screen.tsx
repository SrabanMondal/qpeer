import type { ReactNode } from "react";
import {
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type ScreenProps = {
  children: ReactNode;
  /** Default true. Use false for full-screen content (maps, centred states). */
  scroll?: boolean;
  /** Pull-to-refresh: pass both to enable it. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /**
   * Add the bottom safe-area inset. Default true; tab screens pass false
   * because the tab bar already sits above the inset.
   */
  bottomInset?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Screen body under the header: `bg` background, padding 16, 16 between
 * cards, optional scroll and pull-to-refresh.
 */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  bottomInset = true,
  contentStyle,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingBottom: (bottomInset ? insets.bottom : 0) + Spacing.four,
    paddingLeft: insets.left + Spacing.three,
    paddingRight: insets.right + Spacing.three,
  };

  if (!scroll) {
    return (
      <View
        style={[
          styles.fill,
          styles.content,
          padding,
          { backgroundColor: theme.bg },
          contentStyle,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: theme.bg }]}
      contentContainerStyle={[styles.content, padding, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing ?? false}
            onRefresh={onRefresh}
            colors={[theme.primary]}
            tintColor={theme.primary}
            progressBackgroundColor={theme.card}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: Spacing.three, gap: Spacing.three },
});
