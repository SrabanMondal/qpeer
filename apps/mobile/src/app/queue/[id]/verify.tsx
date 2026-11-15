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
import { getToken, isNetworkError, useStaffRejoin } from "@/lib/api";
import { serverNow } from "@/lib/clock";
import {
  formatDateTime,
  peopleAheadText,
  tokenStatusBadge,
} from "@/lib/queue-format";
import { useTicketKeys } from "@/lib/ticket-keys";
import { showToast } from "@/lib/toast";
import { staffRejoinError } from "@/screens/staff-rejoin";

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
  // R2: the scanned code itself, for "Rejoin for customer" after a miss.
  const [scanned, setScanned] = useState<string | null>(null);
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const rejoin = useStaffRejoin(queueId);
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
    setScanned(result.data);
    setRejoinError(null);
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
    setScanned(null);
    setRejoinError(null);
    handled.current = false;
  };

  const onRejoin = async () => {
    if (!scanned) return;
    setRejoinError(null);
    try {
      const r = await rejoin.mutateAsync({ signedTicket: scanned });
      setLive({ kind: "ok", token: r.token });
      showToast({
        title: `#${r.token.label} is back in the line`,
        message:
          r.token.state === "WAITING"
            ? `${peopleAheadText(r.token.peopleAhead, r.token.peopleAheadHigh)} ahead of them.`
            : undefined,
        tone: "success",
      });
    } catch (e) {
      setRejoinError(staffRejoinError(e));
    }
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
    const canRejoin =
      live.kind === "ok" &&
      live.token.state === "MISSED" &&
      live.token.rejoinAvailable !== false &&
      check.status === "valid";
    const scanAgain = (
      <Button
        title="Scan another ticket"
        variant={canRejoin ? "tonal" : "filled"}
        size={canRejoin ? "medium" : "large"}
        icon="qr_code_scanner"
        onPress={again}
      />
    );
    return (
      <Screen
        // The state's one action stays under the thumb.
        bottomBar={
          canRejoin ? (
            <Button
              title="Rejoin for customer"
              size="large"
              icon="restart_alt"
              loading={rejoin.isPending}
              onPress={() => void onRejoin()}
              needsNetwork
            />
          ) : (
            scanAgain
          )
        }
      >
        <Stack.Screen options={{ title: "Verify ticket" }} />
        <StatusBanner
          tone={look.tone}
          title={look.title}
          detail={look.detail}
        />
        {p ? (
          <Card>
            <ThemedText type="headlineSmall">
              #{tokenLabel(p.s, p.n)}
            </ThemedText>
            <InfoRow label="Valid until" value={formatDateTime(p.exp)} />
            {live.kind === "ok" ? (
              <>
                <InfoRow label="Queue" value={live.token.queueName} />
                <View style={styles.row}>
                  <ThemedText type="bodyLarge" themeColor="onSurfaceVariant">
                    Status now
                  </ThemedText>
                  {badge ? (
                    <Badge label={badge.label} tone={badge.tone} />
                  ) : null}
                </View>
                {live.token.carriedOver ? (
                  <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
                    Kept from an earlier session.
                  </ThemedText>
                ) : null}
                {live.token.state === "MISSED" ? (
                  <>
                    <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
                      {live.token.rejoinAvailable === false
                        ? "This ticket missed its turn and can't rejoin again."
                        : "This ticket missed its turn. It can rejoin once, by the same rule as I'm here."}
                    </ThemedText>
                    {rejoinError ? (
                      <ThemedText type="bodyMedium" themeColor="error">
                        {rejoinError}
                      </ThemedText>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : (
              <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
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
        {canRejoin ? scanAgain : null}
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Stack.Screen options={{ title: "Verify ticket" }} />
      <View style={[styles.cameraWrap, { backgroundColor: theme.scrim }]}>
        {focused ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onScanned}
          />
        ) : null}
      </View>
      <ThemedText type="bodyLarge" style={styles.hint}>
        Scan the customer's ticket code. It is on their ticket screen in the
        Qpeer app. Works without internet.
      </ThemedText>
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
  hint: { textAlign: "center", paddingVertical: Spacing.two },
});
