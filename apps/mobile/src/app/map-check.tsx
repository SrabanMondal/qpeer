import { Camera, MapView, PointAnnotation } from "@rnmapbox/maps";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Card, Screen } from "@/components/ui";
import { config } from "@/config";
import { Radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

// Jammu city centre, [longitude, latitude] as Mapbox expects.
const JAMMU: [number, number] = [74.857, 32.7266];

/** Developer check: the Mapbox token works and a pin renders on Jammu. */
export default function MapCheckScreen() {
  const theme = useTheme();
  if (!config.mapboxToken) {
    return (
      <Screen>
        <Card>
          <ThemedText type="titleMedium">Mapbox token missing</ThemedText>
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            Set EXPO_PUBLIC_MAPBOX_TOKEN in apps/mobile/.env.local (or the EAS
            environment) and restart Metro.
          </ThemedText>
        </Card>
      </Screen>
    );
  }

  return (
    <MapView style={styles.map}>
      <Camera centerCoordinate={JAMMU} zoomLevel={12} animationDuration={0} />
      <PointAnnotation id="jammu" coordinate={JAMMU} title="Jammu">
        <View
          style={[
            styles.pin,
            { backgroundColor: theme.primary, borderColor: theme.onPrimary },
          ]}
        />
      </PointAnnotation>
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  pin: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 3,
  },
});
