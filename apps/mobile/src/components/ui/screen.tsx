import { HeaderHeightContext } from "expo-router/react-navigation";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConnectionBanner } from "@/components/ui/connection-banner";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** Room kept visible under a focused field, so the button below it shows too. */
const REVEAL_BELOW_FIELD = 88;

export type ScreenHandle = {
  /** Scrolls the content to `y` (content coordinates, e.g. from `onLayout`). */
  scrollTo: (y: number) => void;
};

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
  /** The "Connecting…" / "Offline" strip at the top. Default true. */
  connectionBanner?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * A pinned bottom action bar: the state's one primary action stays under
   * the thumb at any scroll position, and rises above the keyboard. It
   * takes the bottom inset when `bottomInset` is on.
   */
  bottomBar?: ReactNode;
  /** Imperative scrolling for scroll screens (e.g. to the first invalid field). */
  ref?: Ref<ScreenHandle>;
};

/**
 * Screen body under the header: `surface` background, padding 16, 16
 * between groups, optional scroll and pull-to-refresh, and the connection
 * banner.
 *
 * Scroll screens are keyboard-aware (B2): the content shrinks above the
 * keyboard, and the focused field plus a button's height below it is
 * scrolled into view when the keyboard opens.
 */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  bottomInset = true,
  connectionBanner = true,
  contentStyle,
  bottomBar,
  ref,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // The KeyboardAvoidingView measures itself relative to the screen body, so
  // it needs the header's height to know where the keyboard starts.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const keyboardOpen = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      scrollTo: (y: number) =>
        scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true }),
    }),
    [],
  );

  /** Scrolls so the focused input and some room below it are visible. */
  const revealFocusedInput = useCallback(() => {
    const view = scrollRef.current;
    const input = TextInput.State.currentlyFocusedInput();
    if (!keyboardOpen.current || !view || !input) return;
    view.getNativeScrollRef()?.measureInWindow((_x, viewTop, _w, viewH) => {
      input.measureInWindow((_ix, inputTop, _iw, inputH) => {
        const top = inputTop - viewTop;
        const bottom = top + inputH + REVEAL_BELOW_FIELD;
        let delta = 0;
        if (bottom > viewH) delta = bottom - viewH;
        // Never push the field itself above the top edge.
        if (top - delta < Spacing.three) delta = top - Spacing.three;
        if (delta > 0) {
          scrollRef.current?.scrollTo({
            y: scrollY.current + delta,
            animated: true,
          });
        }
      });
    });
  }, []);

  useEffect(() => {
    if (!scroll) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = Keyboard.addListener("keyboardDidShow", () => {
      keyboardOpen.current = true;
      // Let the KeyboardAvoidingView shrink the content first.
      timer = setTimeout(revealFocusedInput, 120);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardOpen.current = false;
    });
    return () => {
      show.remove();
      hide.remove();
      if (timer) clearTimeout(timer);
    };
  }, [scroll, revealFocusedInput]);

  const bottomPad = bottomInset ? insets.bottom : 0;
  const padding = {
    // With a bar, the bar takes the inset.
    paddingBottom: (bottomBar ? 0 : bottomPad) + Spacing.four,
    paddingLeft: insets.left + Spacing.three,
    paddingRight: insets.right + Spacing.three,
  };
  const banner = connectionBanner ? <ConnectionBanner /> : null;
  const bar = bottomBar ? (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.surfaceContainer,
          paddingBottom: bottomPad + Spacing.twoHalf,
          paddingLeft: insets.left + Spacing.three,
          paddingRight: insets.right + Spacing.three,
        },
      ]}
    >
      {bottomBar}
    </View>
  ) : null;

  if (!scroll) {
    const body = (
      <View
        style={[
          styles.fill,
          styles.content,
          padding,
          { backgroundColor: theme.surface },
          contentStyle,
        ]}
      >
        {banner}
        {children}
      </View>
    );
    if (!bar) return body;
    return (
      <View style={[styles.fill, { backgroundColor: theme.surface }]}>
        {body}
        {bar}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: theme.surface }]}
      behavior={Platform.OS === "web" ? undefined : "padding"}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.fill}
        contentContainerStyle={[styles.content, padding, contentStyle]}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
        // The content shrinks when the keyboard opens: keep the field visible.
        onLayout={revealFocusedInput}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing ?? false}
              onRefresh={onRefresh}
              colors={[theme.primary]}
              tintColor={theme.primary}
              progressBackgroundColor={theme.surfaceContainerHigh}
            />
          ) : undefined
        }
      >
        {banner}
        {children}
      </ScrollView>
      {bar}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: Spacing.three, gap: Spacing.three },
  bar: { paddingTop: Spacing.twoHalf, gap: Spacing.two },
});
