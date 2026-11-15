import * as MediaLibrary from "expo-media-library";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import {
  Alert,
  Linking,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { captureRef } from "react-native-view-shot";

import { ThemedText } from "@/components/themed-text";
import { Button, ErrorState, LoadingState, Screen } from "@/components/ui";
import { PrintColors, Radius, Spacing, Type } from "@/constants/theme";
import { useQueue } from "@/lib/api";
import { showErrorToast, showToast } from "@/lib/toast";

/** Print colours of the QR card: always dark on white, in both themes. */
const PRINT_INK = PrintColors.ink;
const PRINT_PAPER = PrintColors.paper;

/**
 * BIZ-14: full-screen QR of the queue's join link, with the business and
 * queue name under it. Share the link as text, or the card (QR + names) as
 * a PNG image: share it to any app, or save it to the gallery for printing.
 */
export default function QueueQrScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queue = useQueue(id);
  const { width, height } = useWindowDimensions();
  const card = useRef<View>(null);
  const [busy, setBusy] = useState<"share" | "save" | null>(null);
  // Large, but leave room for the names and the buttons.
  const size = Math.min(width - Spacing.four * 2, height * 0.5, 420);

  if (!queue.data) {
    return (
      <Screen>
        {queue.isError ? (
          <ErrorState
            error={queue.error}
            onRetry={() => queue.refetch()}
            retrying={queue.isFetching}
          />
        ) : (
          <LoadingState />
        )}
      </Screen>
    );
  }

  const { queue: q, business } = queue.data;

  const shareLink = async () => {
    try {
      await Share.share({
        message: `Join the "${q.name}" queue at ${business.name} on Qpeer: ${q.joinUrl}`,
      });
    } catch (e) {
      showErrorToast("Could not share", e);
    }
  };

  /** PNG of the white card (QR + names), in the app's cache folder. */
  const capture = () =>
    captureRef(card, { format: "png", quality: 1, result: "tmpfile" });

  const shareImage = async () => {
    if (busy) return;
    setBusy("share");
    try {
      const uri = await capture();
      if (!(await Sharing.isAvailableAsync())) {
        showToast({
          title: "Sharing is not available on this phone",
          message: "Save the image to your photos instead.",
          tone: "warning",
        });
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: `QR code: ${q.name}`,
      });
    } catch (e) {
      showErrorToast("Could not share the image", e);
    } finally {
      setBusy(null);
    }
  };

  const saveImage = async () => {
    if (busy) return;
    setBusy("save");
    try {
      // Write-only access to photos (no reading of the user's gallery).
      const perm = await MediaLibrary.requestPermissionsAsync(true, ["photo"]);
      if (!perm.granted) {
        Alert.alert(
          "Allow Qpeer to save photos",
          "Qpeer needs permission to save the QR code to your photos. You can also share the image instead.",
          perm.canAskAgain
            ? [{ text: "OK" }]
            : [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Open settings",
                  onPress: () => void Linking.openSettings(),
                },
              ],
        );
        return;
      }
      await MediaLibrary.Asset.create(await capture());
      showToast({ title: "QR code saved to your photos", tone: "success" });
    } catch (e) {
      showErrorToast("Could not save the image", e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      {/* What gets captured: white card, QR and names, dark ink. */}
      <View
        ref={card}
        collapsable={false}
        style={styles.card}
        accessibilityLabel={`QR code for ${q.name}`}
      >
        <QRCode
          value={q.joinUrl}
          size={size}
          quietZone={16}
          color={PRINT_INK}
          backgroundColor={PRINT_PAPER}
        />
        <Text style={[styles.printTitle, { color: PRINT_INK }]}>
          {business.name}
        </Text>
        <Text style={[styles.printQueue, { color: PRINT_INK }]}>{q.name}</Text>
        <Text style={[styles.printHint, { color: PRINT_INK }]}>
          Scan to join the queue with Qpeer
        </Text>
      </View>
      <ThemedText
        type="bodyMedium"
        themeColor="onSurfaceVariant"
        selectable
        style={styles.centred}
      >
        {q.joinUrl}
      </ThemedText>
      <Button
        title="Share QR image"
        icon="share"
        size="large"
        loading={busy === "share"}
        disabled={busy !== null}
        onPress={() => void shareImage()}
        style={styles.button}
      />
      <Button
        title="Save to photos"
        icon="download"
        variant="tonal"
        loading={busy === "save"}
        disabled={busy !== null}
        onPress={() => void saveImage()}
        style={styles.button}
      />
      <Button
        title="Share link"
        icon="link"
        variant="text"
        onPress={() => void shareLink()}
        style={styles.button}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: "center" },
  // The QR's quiet zone stays pure white in both themes so every scanner reads it.
  card: {
    backgroundColor: PRINT_PAPER,
    borderRadius: Radius.card,
    overflow: "hidden",
    alignItems: "center",
    paddingBottom: Spacing.three,
  },
  printTitle: { ...Type.headlineSmall, textAlign: "center" },
  printQueue: { ...Type.titleMedium, textAlign: "center" },
  printHint: {
    ...Type.bodyMedium,
    textAlign: "center",
    marginTop: Spacing.one,
  },
  centred: { textAlign: "center" },
  button: { alignSelf: "stretch" },
});
