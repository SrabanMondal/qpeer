import { Camera, MapView, PointAnnotation } from "@rnmapbox/maps";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { config } from "@/config";
import { Spacing } from "@/constants/theme";

// Jammu city centre, [longitude, latitude] as Mapbox expects.
const JAMMU: [number, number] = [74.857, 32.7266];

export default function MapCheckScreen() {
  if (!config.mapboxToken) {
    return (
      <ThemedView style={styles.message}>
        <ThemedText type="smallBold">Mapbox token missing</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Set EXPO_PUBLIC_MAPBOX_TOKEN in apps/mobile/.env.local (or the EAS
          environment) and restart Metro.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <MapView style={styles.map}>
      <Camera centerCoordinate={JAMMU} zoomLevel={12} animationDuration={0} />
      <PointAnnotation id="jammu" coordinate={JAMMU} title="Jammu">
        <View style={styles.pin} />
      </PointAnnotation>
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  message: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.two,
    justifyContent: "center",
  },
  pin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#208AEF",
    borderWidth: 3,
    borderColor: "#ffffff",
  },
});
