import type { LatLng, MarkerFeatureCollection } from "@qpeer/shared";
import {
  Camera,
  CircleLayer,
  Image,
  Images,
  LocationPuck,
  Logger,
  type MapState,
  MapView,
  ShapeSource,
  StyleURL,
  SymbolLayer,
} from "@rnmapbox/maps";
import {
  type ComponentRef,
  type Ref,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { StyleSheet } from "react-native";

import { useIsDark, useTheme } from "@/hooks/use-theme";
import {
  MapPill,
  type PillKind,
  pillImageId,
  pillKind,
} from "@/screens/discover/map-pill";

/** Mapbox glyph fonts for the cluster counts (the style's own fonts). */
const FONT = ["Open Sans Bold", "Arial Unicode MS Bold"];
/** Points stop clustering above this zoom (street level). */
const CLUSTER_MAX_ZOOM = 14;

/**
 * B14 (INC-041): Mapbox reports a failed style load (e.g. offline) with
 * `console.error`, which the dev build shows as a red LogBox bar. The app
 * handles it (`onLoadError` → calm offline card, retry when back online), so
 * these known network failures are logged as warnings instead. Anything
 * else keeps Mapbox's default logging.
 */
const NETWORK_LOAD_ERROR =
  /map load failed|failed to load style|connectivity|network|unable to resolve host|offline/i;
Logger.setLogCallback((log) => {
  if (log.level === "error" && NETWORK_LOAD_ERROR.test(log.message)) {
    console.warn(`[map] ${log.message}`);
    return true;
  }
  return false;
});

export type QueueMapHandle = {
  /** Moves the camera to a point (MAP-07 recenter, cluster tap). */
  flyTo: (to: LatLng, zoom?: number) => void;
};

type Props = {
  ref?: Ref<QueueMapHandle>;
  initialCenter: LatLng;
  initialZoom: number;
  features: MarkerFeatureCollection;
  selectedId: string | null;
  /** A business pill was tapped. */
  onSelect: (id: string) => void;
  /** The empty map was tapped. */
  onMapPress: () => void;
  /** The camera stopped (pan/zoom ended). */
  onIdle: (state: MapState) => void;
  /** Show the user's blue dot (location permission granted). */
  showUser: boolean;
  /** B14: the map style could not load (offline, Mapbox down). */
  onLoadError?: (message: string) => void;
  /** The style loaded (again). */
  onLoaded?: () => void;
};

/**
 * Live queue map (MAP-01/02): Mapbox map with one clustered GeoJSON source.
 * Clusters are circles with counts; single businesses are pill markers drawn
 * by a SymbolLayer (image stretched around the label), so hundreds of
 * markers stay cheap. Tapping a cluster zooms into it.
 */
export function QueueMap({
  ref,
  initialCenter,
  initialZoom,
  features,
  selectedId,
  onSelect,
  onMapPress,
  onIdle,
  showUser,
  onLoadError,
  onLoaded,
}: Props) {
  const theme = useTheme();
  const dark = useIsDark();
  const camera = useRef<ComponentRef<typeof Camera>>(null);
  const source = useRef<ComponentRef<typeof ShapeSource>>(null);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (to, zoom) =>
        camera.current?.setCamera({
          centerCoordinate: [to.lng, to.lat],
          zoomLevel: zoom,
          animationDuration: 800,
        }),
    }),
    [],
  );

  // Board-style pills (design guide §1): each pill is a React Native view
  // (Doto LEDs on the board face) that Mapbox draws as an image, one image
  // per kind and label. The label is baked in, so the layer draws no text.
  const { shape, pills } = useMemo(() => {
    const seen = new Map<string, { kind: PillKind; label: string }>();
    const withImages = features.features.map((f) => {
      const kind = pillKind(
        f.properties.status,
        f.properties.id === selectedId,
      );
      const image = pillImageId(kind, f.properties.label);
      if (!seen.has(image))
        seen.set(image, { kind, label: f.properties.label });
      return { ...f, properties: { ...f.properties, image } };
    });
    return {
      shape: { ...features, features: withImages },
      pills: [...seen.entries()],
    };
  }, [features, selectedId]);

  const pillStyle = useMemo(
    () => ({
      iconImage: ["get", "image"] as const,
      iconAnchor: "bottom" as const,
      iconAllowOverlap: true,
      iconIgnorePlacement: true,
      // The selected pill is drawn on top of its neighbours.
      symbolSortKey: [
        "case",
        ["==", ["get", "id"], selectedId ?? ""],
        1,
        0,
      ] as const,
    }),
    [selectedId],
  );

  return (
    <MapView
      style={styles.fill}
      styleURL={dark ? StyleURL.Dark : undefined}
      scaleBarEnabled={false}
      compassEnabled={false}
      logoPosition={{ bottom: 8, left: 8 }}
      attributionPosition={{ bottom: 8, right: 8 }}
      onMapIdle={onIdle}
      onPress={onMapPress}
      onMapLoadingError={(e) => {
        // Only a failed style leaves the map blank; tile errors still show
        // the cached map.
        if (!e || e.type === undefined || e.type === "style") {
          console.warn(`[map] load error: ${e?.error ?? "unknown"}`);
          onLoadError?.(e?.error ?? "unknown");
        }
      }}
      onDidFinishLoadingStyle={onLoaded}
    >
      <Camera
        ref={camera}
        defaultSettings={{
          centerCoordinate: [initialCenter.lng, initialCenter.lat],
          zoomLevel: initialZoom,
        }}
      />
      {showUser ? (
        <LocationPuck visible pulsing={{ isEnabled: false }} />
      ) : null}
      <Images>
        {pills.map(([id, p]) => (
          <Image key={id} name={id}>
            <MapPill kind={p.kind} label={p.label} />
          </Image>
        ))}
      </Images>
      <ShapeSource
        ref={source}
        id="businesses"
        shape={shape}
        cluster
        clusterRadius={48}
        clusterMaxZoomLevel={CLUSTER_MAX_ZOOM}
        hitbox={{ width: 44, height: 44 }}
        onPress={async (e) => {
          const feature = e.features[0];
          if (!feature) return;
          const props = feature.properties ?? {};
          if (props.cluster) {
            const geometry = feature.geometry;
            if (geometry.type !== "Point") return;
            const [lng, lat] = geometry.coordinates;
            let zoom = CLUSTER_MAX_ZOOM + 1;
            try {
              zoom = await (source.current?.getClusterExpansionZoom(feature) ??
                zoom);
            } catch {
              // Keep the default zoom.
            }
            camera.current?.setCamera({
              centerCoordinate: [lng, lat],
              zoomLevel: zoom,
              animationDuration: 500,
            });
            return;
          }
          if (typeof props.id === "string") onSelect(props.id);
        }}
      >
        <CircleLayer
          id="business-clusters"
          filter={["has", "point_count"]}
          style={{
            circleColor: theme.primary,
            circleRadius: ["step", ["get", "point_count"], 18, 10, 22, 50, 28],
            circleStrokeColor: theme.onPrimary,
            circleStrokeWidth: 2,
          }}
        />
        <SymbolLayer
          id="business-cluster-counts"
          filter={["has", "point_count"]}
          style={{
            textField: ["get", "point_count_abbreviated"],
            textFont: FONT,
            textSize: 14,
            textColor: theme.onPrimary,
            textAllowOverlap: true,
            textIgnorePlacement: true,
          }}
        />
        <SymbolLayer
          id="business-pills"
          filter={["!", ["has", "point_count"]]}
          style={pillStyle}
        />
      </ShapeSource>
    </MapView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
