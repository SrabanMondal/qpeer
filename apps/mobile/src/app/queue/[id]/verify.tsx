import {
  type TicketCheck,
  type TokenView,
  tokenLabel,
  verifyTicket,
} from "@qpeer/shared";
import {
  type BarcodeScanningResult,
  CameraView,
  useCameraPermissions,
} from "expo-camera";
import { Stack, useIsFocused, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Linking, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InfoRow,
  LoadingState,
  Screen,
  StatusBanner,
} from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { getToken, isNetworkError } from "@/lib/api";
import { serverNow } from "@/lib/clock";
import { formatDateTime, tokenStatusBadge } from "@/lib/queue-format";
import { useTicketKeys } from "@/lib/ticket-keys";

type Live =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; token: TokenView }
  | { kind: "offline" }
  | { kind: "error" };

const RESULT: Record<
  TicketCheck["status"],
  { tone: "active" | "paused" | "closed"; title: string; detail: string }
> = {
  valid: {
    tone: "active",
    title: "Genuine ticket for this queue",
    detail: "Signed by Qpeer and not expired.",
  },
  expired: {
    tone: "paused",
    title: "Expired ticket",
    detail: "The ticket was genuine but its validity has ended.",
  },
  other_queue: {
    tone: "paused",
    title: "Ticket for another queue",
    detail: "Genuine, but issued for a different queue.",
  },
  bad_signature: {
    tone: "closed",
    title: "Not a valid ticket",
    detail: "The code was changed or not issued by Qpeer.",
  },
  unknown_key: {
    tone: "closed",
    title: "Can't check this ticket",
    detail:
      "It was signed with a key this phone doesn't know yet. Go online once to update, then scan again.",
  },
  malformed: {
    tone: "closed",
    title: "Not a Qpeer ticket",
    detail: "Ask the customer to open their ticket in the Qpeer app.",
  },
};

/**
 * C3: staff scan a customer's ticket code. The signature is checked on the
 * phone with the cached public key (works offline); when online the live
 * state of the token is read too (served, left, called…).
 */
export default function VerifyTicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queueId = id ?? "";
  const focused = useIsFocused();
  const theme = useTheme();
  const keys = useTicketKeys();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [check, setCheck] = useState<TicketCheck | null>(null);
  const [live, setLive] = useState<Live>({ kind: "idle" });
  const handled = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  const onScanned = (result: BarcodeScanningResult) => {
    if (handled.current) return;
    handled.current = true;
    const r = verifyTicket(result.data, keys, { now: serverNow(), queueId });
    setCheck(r);
    if (r.status === "malformed" || r.status === "bad_signature") return;
    setLive({ kind: "loading" });
    getToken(r.payload.t).then(
      (token) => setLive({ kind: "ok", token }),
      (e) => setLive({ kind: isNetworkError(e) ? "offline" : "error" }),
    );
  };

  const again = () => {
    setCheck(null);
    setLive({ kind: "idle" });
    handled.current = false;
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
          title="Allow the camera to scan tickets"
          message="The camera only reads the customer's ticket code. Nothing is recorded."
          action={
            <Button
              title={permission.canAskAgain ? "Allow camera" : "Open settings"}
              variant="brand"
              icon={permission.canAskAgain ? "camera" : "settings"}
              onPress={() => {
                if (permission.canAskAgain) void requestPermission();
                else void Linking.openSettings();
              }}
            />
          }
        />
      </Screen>
    );
  }

  if (check) {
    const look = RESULT[check.status];
    const p = "payload" in check ? check.payload : null;
    const badge = live.kind === "ok" ? tokenStatusBadge(live.token) : null;
    return (
      <Screen>
        <Stack.Screen options={{ title: "Verify ticket" }} />
        <StatusBanner
          tone={look.tone}
          title={look.title}
          detail={look.detail}
        />
        {p ? (
          <Card>
            <ThemedText type="title">#{tokenLabel(p.s, p.n)}</ThemedText>
            <InfoRow label="Issued" value={formatDateTime(p.iat)} />
            <InfoRow label="Valid until" value={formatDateTime(p.exp)} />
            {live.kind === "ok" ? (
              <>
                <InfoRow label="Queue" value={live.token.queueName} />
                <View style={styles.row}>
                  <ThemedText type="body" themeColor="inkMuted">
                    Status now
                  </ThemedText>
                  {badge ? (
                    <Badge label={badge.label} tone={badge.tone} />
                  ) : null}
                </View>
                {live.token.carriedOver ? (
                  <ThemedText type="small" themeColor="inkMuted">
                    Kept from an earlier session.
                  </ThemedText>
                ) : null}
              </>
            ) : (
              <ThemedText type="small" themeColor="inkMuted">
                {live.kind === "loading"
                  ? "Checking the live status…"
                  : live.kind === "offline"
                    ? "Offline: the signature was checked on this phone; the live status (served, left) can't be checked now."
                    : live.kind === "error"
                      ? "The live status could not be read (the ticket may belong to another business)."
                      : ""}
              </ThemedText>
            )}
          </Card>
        ) : null}
        <Button
          title="Scan another ticket"
          variant="brand"
          icon="qr_code_scanner"
          onPress={again}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ title: "Verify ticket" }} />
      <View style={[styles.cameraWrap, { backgroundColor: theme.header }]}>
        {focused ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onScanned}
          />
        ) : null}
      </View>
      <StatusBanner
        tone="active"
        title="Scan the customer's ticket code"
        detail="It is on their ticket screen in the Qpeer app. Works without internet."
      />
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
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.one,
  },
});
