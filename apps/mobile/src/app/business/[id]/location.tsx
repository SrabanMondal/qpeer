import { LatLng } from "@qpeer/shared";
import { Camera, MapView } from "@rnmapbox/maps";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { Button, ErrorState, LoadingState, Screen } from "@/components/ui";
import { config } from "@/config";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useBusiness, useUpdateBusiness } from "@/lib/api";
import { errorText } from "@/lib/error-messages";
import { formatLatLng } from "@/lib/format";

/** Jammu city centre, [longitude, latitude] as Mapbox expects. */
const JAMMU: [number, number] = [74.857, 32.7266];
const PIN_SIZE = 28;
const STEM = 14;

type LngLat = [number, number];

/** Asks for when-in-use permission and returns the phone's position, or null. */
async function phonePosition(): Promise<LngLat | null> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return null;
  const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
  const fix =
    last ??
    (await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }));
  return [fix.coords.longitude, fix.coords.latitude];
}

/**
 * BIZ-03 / BIZ-04: set or move the business pin. The pin is fixed in the
 * centre of the screen and the map moves under it; Save stores the centre.
 */
export default function BusinessLocationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const business = useBusiness(id);

  if (!config.mapboxToken) {
    return (
      <Screen>
        <ThemedText type="heading">Map not available</ThemedText>
        <ThemedText type="small" themeColor="inkMuted">
          Set EXPO_PUBLIC_MAPBOX_TOKEN in apps/mobile/.env.local (or the EAS
          environment) and restart Metro.
        </ThemedText>
      </Screen>
    );
  }

  if (!business.data) {
    return (
      <Screen>
        {business.isError ? (
          <ErrorState
            error={business.error}
            onRetry={() => business.refetch()}
            retrying={business.isFetching}
          />
        ) : (
          <LoadingState />
        )}
      </Screen>
    );
  }

  const pin = business.data.location;
  return (
    <PinPicker businessId={id} initial={pin ? [pin.lng, pin.lat] : null} />
  );
}

function PinPicker({
  businessId,
  initial,
}: {
  businessId: string;
  /** The existing pin, or null when the business has none yet. */
  initial: LngLat | null;
}) {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const camera = useRef<ComponentRef<typeof Camera>>(null);
  const update = useUpdateBusiness(businessId);
  const [center, setCenter] = useState<LngLat>(initial ?? JAMMU);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  const flyTo = (target: LngLat) => {
    camera.current?.setCamera({
      centerCoordinate: target,
      zoomLevel: 16,
      animationDuration: 800,
    });
    setCenter(target);
  };

  const locateMe = async (quiet: boolean) => {
    setLocating(true);
    try {
      const position = await phonePosition();
      if (position) {
        setLocationNote(null);
        flyTo(position);
      } else {
        const note =
          "Location permission is off. Move the map to your business instead.";
        setLocationNote(note);
        if (!quiet) Alert.alert("Location not available", note);
      }
    } catch {
      const note = "Could not get your location. Move the map instead.";
      setLocationNote(note);
      if (!quiet) Alert.alert("Location not available", note);
    } finally {
      setLocating(false);
    }
  };

  // No pin yet: start at the phone's location when we can get it.
  const startedFromPhone = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on open
  useEffect(() => {
    if (initial || startedFromPhone.current) return;
    startedFromPhone.current = true;
    void locateMe(true);
  }, []);

  const save = async () => {
    const location = LatLng.safeParse({ lat: center[1], lng: center[0] });
    if (!location.success) {
      Alert.alert("Invalid position", "Move the map and try again.");
      return;
    }
    try {
      await update.mutateAsync({ location: location.data });
      router.back();
    } catch (e) {
      Alert.alert("Could not save the pin", errorText(e));
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: theme.bg }]}>
      <View style={styles.fill}>
        <MapView
          style={styles.fill}
          scaleBarEnabled={false}
          onCameraChanged={(state) => {
            const [lng, lat] = state.properties.center;
            setCenter([lng, lat]);
          }}
        >
          <Camera
            ref={camera}
            defaultSettings={{
              centerCoordinate: initial ?? JAMMU,
              zoomLevel: initial ? 16 : 13,
            }}
          />
        </MapView>
        {/* The fixed centre pin: its tip marks the saved point. */}
        <View style={styles.pinLayer} pointerEvents="none">
          <View style={styles.pinWrap}>
            <View
              style={[
                styles.pinHead,
                { backgroundColor: theme.brand, borderColor: theme.card },
              ]}
            />
            <View style={[styles.pinStem, { backgroundColor: theme.brand }]} />
          </View>
        </View>
      </View>
      <View
        style={[
          styles.panel,
          {
            paddingBottom: insets.bottom + Spacing.three,
            backgroundColor: theme.card,
            borderColor: theme.border,
          },
        ]}
      >
        {locationNote ? (
          <ThemedText type="small" themeColor="danger">
            {locationNote}
          </ThemedText>
        ) : (
          <ThemedText type="body">
            Move the map until the pin sits on your entrance.
          </ThemedText>
        )}
        <ThemedText type="small" themeColor="inkMuted" selectable>
          {formatLatLng(center[1], center[0])}
        </ThemedText>
        <Button
          title="Use my location"
          icon="my_location"
          variant="outline"
          onPress={() => {
            void locateMe(false);
          }}
          loading={locating}
        />
        <Button title="Save pin" onPress={save} loading={update.isPending} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pinLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  // Shift up by its own height so the stem's tip is at the exact centre.
  pinWrap: { alignItems: "center", marginBottom: PIN_SIZE + STEM },
  pinHead: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: Radius.pill,
    borderWidth: 3,
  },
  pinStem: { width: 3, height: STEM },
  // Rounded top sheet over the map.
  panel: {
    marginTop: -Radius.card,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
});
