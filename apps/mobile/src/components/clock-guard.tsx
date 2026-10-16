import { useEffect } from "react";
import {
  AppState,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { checkClock, useClockStatus } from "@/lib/clock";

/** "12 minutes", "3 hours", "2 days" for an absolute offset. */
export function skewAmountText(offsetMs: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(offsetMs) / 60_000));
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes < 90) return plural(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.round(hours / 24), "day");
}

/** "Your phone's clock is about 12 minutes ahead" (negative offset = phone is fast). */
export function skewSentence(offsetMs: number): string {
  return `Your phone's clock is about ${skewAmountText(offsetMs)} ${
    offsetMs < 0 ? "ahead" : "behind"
  }.`;
}

async function openDateSettings() {
  if (Platform.OS === "android") {
    try {
      await Linking.sendIntent("android.settings.DATE_SETTINGS");
      return;
    } catch {
      // Some phones have no separate date screen: open the app settings.
    }
  }
  try {
    await Linking.openSettings();
  } catch {
    // Nothing more to try; the text tells the user where to go.
  }
}

/**
 * B9: measures the phone's clock against the server at startup and every
 * time the app comes back to the foreground. A skew over 2 min shows a
 * full-screen popup that cannot be dismissed until the time is fixed.
 */
export function ClockGuard() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { status, offsetMs, checking } = useClockStatus();

  useEffect(() => {
    void checkClock();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void checkClock();
    });
    return () => sub.remove();
  }, []);

  const blocking = status === "blocking";

  return (
    <Modal
      visible={blocking}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      // Not dismissible: Android Back does nothing.
      onRequestClose={() => undefined}
    >
      <ScrollView
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.five,
            paddingBottom: insets.bottom + Spacing.four,
            paddingLeft: insets.left + Spacing.three,
            paddingRight: insets.right + Spacing.three,
          },
        ]}
      >
        <View style={styles.inner}>
          <View
            style={[styles.iconWrap, { backgroundColor: theme.warningSoft }]}
          >
            <Icon name="schedule" size={56} color="warning" />
          </View>
          <ThemedText
            type="title"
            style={styles.centred}
            accessibilityRole="header"
          >
            Your phone's time is wrong
          </ThemedText>
          <ThemedText
            type="heading"
            style={styles.centred}
            accessibilityLiveRegion="polite"
          >
            {skewSentence(offsetMs)}
          </ThemedText>
          <ThemedText type="body" themeColor="inkMuted" style={styles.centred}>
            Queue times and alerts depend on the correct time. Turn on automatic
            date and time in your phone's Settings, then come back.
          </ThemedText>
          <View style={styles.actions}>
            <Button
              title="Open date & time settings"
              icon="settings"
              onPress={() => void openDateSettings()}
            />
            <Button
              title="Check again"
              icon="refresh"
              variant="secondary"
              loading={checking}
              onPress={() => void checkClock()}
            />
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center" },
  inner: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    alignItems: "center",
    gap: Spacing.three,
  },
  iconWrap: {
    width: 104,
    height: 104,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  centred: { textAlign: "center" },
  actions: {
    alignSelf: "stretch",
    gap: Spacing.twoHalf,
    marginTop: Spacing.two,
  },
});
