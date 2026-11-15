import {
  type BarcodeScanningResult,
  CameraView,
  useCameraPermissions,
} from "expo-camera";
import { useIsFocused, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Linking, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  EmptyState,
  LoadingState,
  Screen,
  StatusBanner,
} from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { parseJoinCode } from "@/lib/join-link";

/** How long the "not a Qpeer code" message stays before scanning again. */
const BAD_CODE_PAUSE_MS = 2500;

/** JON-01: in-app QR scanner (QR codes only). */
export default function ScanScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const theme = useTheme();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [badCode, setBadCode] = useState(false);
  const handled = useRef(false);

  // Back from Settings: read the permission again.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  useEffect(() => {
    if (!badCode) return;
    const timer = setTimeout(() => {
      setBadCode(false);
      handled.current = false;
    }, BAD_CODE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [badCode]);

  const onScanned = (result: BarcodeScanningResult) => {
    if (handled.current) return;
    handled.current = true;
    const queueId = parseJoinCode(result.data);
    if (!queueId) {
      setBadCode(true);
      return;
    }
    router.replace({ pathname: "/q/[id]", params: { id: queueId } });
  };

  if (!permission) {
    return (
      <Screen>
        <LoadingState label="Checking camera permission…" />
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <EmptyState
          icon="camera"
          title="Allow the camera to scan"
          message={
            permission.canAskAgain
              ? "Qpeer uses the camera only to read the queue's QR code at the counter. Nothing is recorded."
              : "Camera access is turned off for Qpeer. Open Settings → Permissions → Camera and choose Allow, then come back."
          }
          action={
            permission.canAskAgain ? (
              <Button
                title="Allow camera"
                icon="camera"
                onPress={() => {
                  void requestPermission();
                }}
              />
            ) : (
              <Button
                title="Open settings"
                icon="settings"
                onPress={() => {
                  void Linking.openSettings();
                }}
              />
            )
          }
        />
        <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
          You can also scan the code with your phone's camera app: it opens
          Qpeer on the join screen.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <View style={[styles.cameraWrap, { backgroundColor: theme.scrim }]}>
        {focused ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={badCode ? undefined : onScanned}
          />
        ) : null}
      </View>
      {badCode ? (
        <StatusBanner
          tone="paused"
          title="This isn't a Qpeer queue code"
          detail="Scan the QR code shown at the business counter."
        />
      ) : (
        <ThemedText type="bodyLarge" style={styles.hint}>
          Point the camera at the queue's QR code at the business counter.
        </ThemedText>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraWrap: {
    flex: 1,
    borderRadius: Radius.card,
    overflow: "hidden",
    minHeight: 280,
    marginBottom: Spacing.one,
  },
  hint: { textAlign: "center", paddingVertical: Spacing.two },
});
