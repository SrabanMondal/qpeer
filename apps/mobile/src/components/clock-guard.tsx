import {
  AlertDialog,
  Text as ComposeText,
  Host,
  RNHostView,
} from "@expo/ui/jetpack-compose";
import { useEffect } from "react";
import { AppState, Linking, Platform, StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useIsDark, useTheme } from "@/hooks/use-theme";
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
 * time the app comes back to the foreground. A skew over 2 min shows an M3
 * dialog (Jetpack Compose `AlertDialog` from `@expo/ui`) that Back and the
 * scrim cannot dismiss until the time is fixed: it blocks the app, so it is
 * a decision surface, not a screen.
 */
export function ClockGuard() {
  const theme = useTheme();
  const dark = useIsDark();
  const { status, offsetMs, checking } = useClockStatus();

  useEffect(() => {
    void checkClock();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void checkClock();
    });
    return () => sub.remove();
  }, []);

  if (status !== "blocking") return null;

  return (
    <Host
      style={styles.host}
      pointerEvents="none"
      colorScheme={dark ? "dark" : "light"}
    >
      <AlertDialog
        // Not dismissible: Back and taps outside do nothing.
        onDismissRequest={() => undefined}
        properties={{ dismissOnBackPress: false, dismissOnClickOutside: false }}
        colors={{
          containerColor: theme.surfaceContainerHigh,
          iconContentColor: theme.primary,
          titleContentColor: theme.onSurface,
          textContentColor: theme.onSurfaceVariant,
        }}
      >
        <AlertDialog.Icon>
          <RNHostView matchContents>
            <View accessible={false}>
              <Icon name="schedule" color="primary" />
            </View>
          </RNHostView>
        </AlertDialog.Icon>
        <AlertDialog.Title>
          <ComposeText
            color={theme.onSurface}
            style={{ typography: "headlineSmall" }}
          >
            Your phone's time is wrong
          </ComposeText>
        </AlertDialog.Title>
        <AlertDialog.Text>
          <ComposeText
            color={theme.onSurfaceVariant}
            style={{ typography: "bodyMedium" }}
          >
            {`${skewSentence(offsetMs)} Queue times and alerts depend on the correct time. Turn on automatic date and time in your phone's Settings, then come back.`}
          </ComposeText>
        </AlertDialog.Text>
        <AlertDialog.DismissButton>
          <RNHostView matchContents>
            <Button
              title="Check again"
              variant="text"
              loading={checking}
              onPress={() => void checkClock()}
            />
          </RNHostView>
        </AlertDialog.DismissButton>
        <AlertDialog.ConfirmButton>
          <RNHostView matchContents>
            <Button
              title="Open settings"
              variant="text"
              accessibilityLabel="Open date and time settings"
              onPress={() => void openDateSettings()}
            />
          </RNHostView>
        </AlertDialog.ConfirmButton>
      </AlertDialog>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute" },
});
