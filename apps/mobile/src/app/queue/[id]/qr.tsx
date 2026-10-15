import { useLocalSearchParams } from "expo-router";
import {
  Alert,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

import { ThemedText } from "@/components/themed-text";
import { Button, ErrorState, LoadingState, Screen } from "@/components/ui";
import { Radius, Spacing } from "@/constants/theme";
import { useQueue } from "@/lib/api";
import { errorText } from "@/lib/error-messages";

/**
 * BIZ-14: full-screen QR of the queue's join link, with the business and
 * queue name under it. Shares the link as text.
 *
 * TODO(native): share QR as image. Saving or sharing the QR as a picture (and
 * saving it to the gallery for printing) needs react-native-view-shot plus
 * expo-sharing / expo-media-library, which are not in the current dev build.
 */
export default function QueueQrScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queue = useQueue(id);
  const { width, height } = useWindowDimensions();
  // Large, but leave room for the names and the Share button.
  const size = Math.min(width - Spacing.four * 2, height * 0.55, 420);

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

  const share = async () => {
    try {
      await Share.share({
        message: `Join the "${q.name}" queue at ${business.name} on Qpeer: ${q.joinUrl}`,
      });
    } catch (e) {
      Alert.alert("Could not share", errorText(e));
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      {/* White quiet zone so the code scans in dark mode too. */}
      <View style={styles.qrBox} accessibilityLabel={`QR code for ${q.name}`}>
        <QRCode value={q.joinUrl} size={size} quietZone={16} />
      </View>
      <ThemedText type="title" style={styles.centred}>
        {business.name}
      </ThemedText>
      <ThemedText type="heading" themeColor="primary" style={styles.centred}>
        {q.name}
      </ThemedText>
      <ThemedText
        type="small"
        themeColor="inkMuted"
        selectable
        style={styles.centred}
      >
        Scan with the phone camera or the Qpeer app to join.{"\n"}
        {q.joinUrl}
      </ThemedText>
      <Button
        title="Share link"
        icon="share"
        variant="brand"
        onPress={share}
        style={styles.button}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: "center" },
  // The QR's quiet zone stays pure white in both themes so every scanner reads it.
  qrBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: Radius.card,
    overflow: "hidden",
  },
  centred: { textAlign: "center" },
  button: { alignSelf: "stretch" },
});
