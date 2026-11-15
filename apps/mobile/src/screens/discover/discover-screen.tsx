import {
  type BusinessCategory,
  boxFromCorners,
  clampMapBox,
  type LatLng,
  LIST_RADIUS_KM,
  listBox,
  type MapBox,
  type MapBusiness,
  type MapSort,
  mapQueryString,
  markerFeatures,
  sortBusinesses,
  withinRadius,
} from "@qpeer/shared";
import type { MapState } from "@rnmapbox/maps";
import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  ConnectionBanner,
  EmptyState,
  ErrorState,
  Fab,
  Icon,
  type IconName,
  LoadingState,
} from "@/components/ui";
import { config } from "@/config";
import { Elevation, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { isNetworkError, useMapBusinesses } from "@/lib/api";
import { turnOnLocation } from "@/lib/join-location";
import { onBackOnline, useOffline } from "@/lib/network";
import { useNow } from "@/lib/queue-format";
import { peekStored, useStored, writeStored } from "@/lib/storage";
import { showToast } from "@/lib/toast";
import {
  locateProblemText,
  locateUser,
  quietUserLocation,
} from "@/lib/user-location";
import { BusinessCard } from "@/screens/discover/business-card";
import { BusinessList } from "@/screens/discover/business-list";
import { QueueMap, type QueueMapHandle } from "@/screens/discover/queue-map";
import { DiscoverTopBar, type DiscoverView } from "@/screens/discover/top-bar";
import { OfflineTicketsCard } from "@/screens/offline-tickets-card";

/** Jammu city centre (MAP-01 default). */
const JAMMU: LatLng = { lat: 32.7266, lng: 74.857 };
const START_ZOOM = 12.5;
const HAS_MAP_TOKEN = Boolean(config.mapboxToken);
const USER_ZOOM = 14;
/** MAP-03: wait this long after the map stops before asking for the new area. */
const IDLE_DEBOUNCE_MS = 400;
/** First request, before the map reports its real bounds (≈ a phone screen at zoom 12.5). */
const START_HALF_LAT = 0.08;
const START_HALF_LNG = 0.06;

function boxAround(c: LatLng): MapBox {
  return {
    minLat: c.lat - START_HALF_LAT,
    minLng: c.lng - START_HALF_LNG,
    maxLat: c.lat + START_HALF_LAT,
    maxLng: c.lng + START_HALF_LNG,
  };
}

/**
 * Customer Home (Step 3): live queue map with a list view (MAP-01…04, MAP-07).
 */
export function DiscoverScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const map = useRef<QueueMapHandle>(null);
  const hasToken = HAS_MAP_TOKEN;

  // C1: filters, sort, view and the last camera survive a restart.
  const savedPrefs = peekStored("mapPrefs");
  const savedCamera = useRef(peekStored("mapCamera")).current;
  const [view, setView] = useState<DiscoverView>(
    hasToken ? (savedPrefs?.view ?? "map") : "list",
  );
  const [category, setCategory] = useState<BusinessCategory | null>(
    savedPrefs?.category ?? null,
  );
  const [openNow, setOpenNow] = useState(savedPrefs?.openNow ?? false);
  const [sort, setSort] = useState<MapSort>(savedPrefs?.sort ?? "distance");
  const start: LatLng = savedCamera
    ? { lat: savedCamera.lat, lng: savedCamera.lng }
    : JAMMU;
  const [box, setBox] = useState<MapBox>(
    () => clampMapBox(boxAround(start)).box,
  );
  const offline = useOffline();
  // B14: the map style failed to load; `mapKey` remounts the map to retry.
  const [mapFailed, setMapFailed] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const now = useNow(focused, 30_000);

  // Storage may load after the first render (cold start): apply what it
  // holds once, and only then start saving changes.
  const prefsStore = useStored("mapPrefs");
  const cameraStore = useStored("mapCamera");
  const [prefsApplied, setPrefsApplied] = useState(savedPrefs !== undefined);
  useEffect(() => {
    if (prefsApplied || !prefsStore.ready || !cameraStore.ready) return;
    const p = prefsStore.value;
    if (p) {
      setCategory(p.category);
      setOpenNow(p.openNow);
      setSort(p.sort);
      if (hasToken) setView(p.view);
    }
    const cam = cameraStore.value;
    if (cam && !savedCamera) {
      map.current?.flyTo({ lat: cam.lat, lng: cam.lng }, cam.zoom);
    }
    setPrefsApplied(true);
  }, [
    prefsApplied,
    prefsStore.ready,
    prefsStore.value,
    cameraStore.ready,
    cameraStore.value,
    savedCamera,
  ]);
  useEffect(() => {
    if (prefsApplied) {
      void writeStored("mapPrefs", { category, openNow, sort, view });
    }
  }, [prefsApplied, category, openNow, sort, view]);

  // Back online after a failed map load: try the style again.
  useEffect(
    () =>
      onBackOnline(() => {
        setMapFailed((failed) => {
          if (failed) setMapKey((k) => k + 1);
          return false;
        });
      }),
    [],
  );
  const [clamped, setClamped] = useState(false);
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const [selected, setSelected] = useState<MapBusiness | null>(null);
  const [locating, setLocating] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [topHeight, setTopHeight] = useState(0);

  // The map centre (last camera stop); the List reaches around it when the
  // user's location is unknown.
  const [mapCentre, setMapCentre] = useState<LatLng>(start);

  const listMode = view === "list" || !hasToken;
  // The map asks for its visible box (pills); the List for ~25 km around the
  // user (or the map centre), whatever the map's zoom.
  const query = mapQueryString(box, { category, openNow });
  const data = useMapBusinesses(listMode ? null : query, focused);
  const items = useMemo(() => data.data?.items ?? [], [data.data]);
  const listCentre = userLoc ?? mapCentre;
  const listQuery = mapQueryString(listBox(listCentre), { category, openNow });
  const listData = useMapBusinesses(listMode ? listQuery : null, focused);
  const listItems = useMemo(
    () => withinRadius(listData.data?.items ?? [], listCentre),
    [listData.data, listCentre],
  );
  // What the visible view shows: notices, loading/empty/error states.
  const shown = listMode ? listData : data;
  const shownItems = listMode ? listItems : items;

  // MAP-01: start on the user when location permission was already given
  // (no prompt on open); otherwise stay on Jammu.
  useEffect(() => {
    let cancelled = false;
    void quietUserLocation().then((pos) => {
      if (cancelled || !pos) return;
      setUserLoc(pos);
      map.current?.flyTo(pos, USER_ZOOM);
      // Without a map (token missing) nothing else reports the new area.
      if (!HAS_MAP_TOKEN) setBox(clampMapBox(boxAround(pos)).box);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // MAP-03: refetch the visible area once the camera has been still for 400 ms.
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdle = useCallback((state: MapState) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      const { ne, sw } = state.properties.bounds;
      const [lng, lat] = state.properties.center;
      void writeStored("mapCamera", { lat, lng, zoom: state.properties.zoom });
      setMapCentre((old) =>
        old.lat === lat && old.lng === lng ? old : { lat, lng },
      );
      const next = clampMapBox(boxFromCorners(ne, sw));
      setClamped(next.clamped);
      setBox((old) =>
        old.minLat === next.box.minLat &&
        old.minLng === next.box.minLng &&
        old.maxLat === next.box.maxLat &&
        old.maxLng === next.box.maxLng
          ? old
          : next.box,
      );
    }, IDLE_DEBOUNCE_MS);
  }, []);
  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );

  // Keep the open card in step with fresh data (live counts). B18
  // (INC-045): once the current results no longer hold the business (a
  // filter hid it, or the map moved away), close the card.
  const settled = data.data !== undefined && !data.isPlaceholderData;
  useEffect(() => {
    if (!selected) return;
    const fresh = items.find((b) => b.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
    else if (!fresh && settled) setSelected(null);
  }, [items, selected, settled]);

  const features = useMemo(() => markerFeatures(items, now), [items, now]);
  const effectiveSort: MapSort =
    sort === "distance" && !userLoc ? "wait" : sort;
  const rows = useMemo(
    () => sortBusinesses(listItems, effectiveSort, userLoc),
    [listItems, effectiveSort, userLoc],
  );

  const openDetails = (id: string) =>
    router.push({ pathname: "/business/[id]/public", params: { id } });

  const recenter = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const r = await locateUser();
      if (r.ok) {
        setUserLoc(r.position);
        map.current?.flyTo(r.position, USER_ZOOM);
        // The map (also when hidden behind the list) reports the new area
        // when it stops; without a map, ask for the area around the user.
        if (!hasToken) setBox(clampMapBox(boxAround(r.position)).box);
        return;
      }
      const text = locateProblemText(r.problem);
      const p = r.problem;
      showToast({
        title: text.title,
        message:
          p.kind === "services_off"
            ? `${text.message} Tap here to turn it on.`
            : p.kind === "denied" && !p.canAskAgain
              ? `${text.message} Tap here to open Settings.`
              : text.message,
        tone: "warning",
        durationMs: 7000,
        onPress:
          p.kind === "services_off"
            ? () => {
                void turnOnLocation().then((on) => {
                  if (on) void recenter();
                });
              }
            : p.kind === "denied" && !p.canAskAgain
              ? () => void Linking.openSettings()
              : undefined,
      });
    } finally {
      setLocating(false);
    }
  };

  const filtersOn = category !== null || openNow;
  const firstLoad = shown.isPending && shown.fetchStatus === "fetching";
  const failedWithoutData = shown.isError && !shown.data;
  const empty = shown.data !== undefined && shownItems.length === 0;

  const notices = (
    <>
      <ConnectionBanner />
      {/* A developer message: release builds just show the list. */}
      {!hasToken && __DEV__ ? (
        <Card>
          <ThemedText type="titleMedium">Map not available</ThemedText>
          <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
            Mapbox token missing: set EXPO_PUBLIC_MAPBOX_TOKEN in
            apps/mobile/.env.local (or the EAS environment) and restart Metro.
            The list still works.
          </ThemedText>
        </Card>
      ) : null}
      {clamped && !listMode ? (
        <Notice
          icon="zoom_in"
          text="Zoom in to see queues across this whole area."
        />
      ) : null}
      {shown.data?.truncated ? (
        <Notice
          icon="info"
          text={
            listMode
              ? "Showing the nearest 200."
              : "Showing the nearest 200. Zoom in to see more."
          }
        />
      ) : null}
      {shown.isError && shown.data && !isNetworkError(shown.error) ? (
        <Notice
          icon="cloud_off"
          text="Could not refresh. Showing the last results."
        />
      ) : null}
    </>
  );

  // B13/B14: offline with nothing to show, or the map style failed: a calm
  // card with the saved tickets, never a spinner or a black map.
  const offlineCard =
    (offline && !shown.data) || (mapFailed && !listMode) ? (
      <OfflineTicketsCard
        title={
          mapFailed && !offline
            ? "The map can't load"
            : "The map needs internet"
        }
        onRetry={() => {
          setMapFailed(false);
          setMapKey((k) => k + 1);
          void shown.refetch();
        }}
      />
    ) : null;

  const stateCard = offlineCard ? (
    offlineCard
  ) : firstLoad ? (
    <LoadingState label="Loading queues…" />
  ) : failedWithoutData ? (
    <ErrorState
      title="Could not load queues"
      error={shown.error}
      onRetry={() => void shown.refetch()}
      retrying={shown.isFetching}
    />
  ) : empty ? (
    <EmptyState
      icon="map"
      title={filtersOn ? "No matching queues here" : "No queues here yet"}
      message={
        listMode
          ? filtersOn
            ? `Nothing within ~${LIST_RADIUS_KM} km. Try All categories or turn off Open now.`
            : `Nothing within ~${LIST_RADIUS_KM} km yet.`
          : filtersOn
            ? "Try All categories, turn off Open now, or move the map."
            : "Try zooming out or another area."
      }
      action={
        filtersOn ? (
          <Button
            title="Clear filters"
            variant="tonal"
            onPress={() => {
              setCategory(null);
              setOpenNow(false);
            }}
          />
        ) : undefined
      }
    />
  ) : null;

  return (
    <View style={[styles.fill, { backgroundColor: theme.surface }]}>
      {hasToken ? (
        <QueueMap
          key={mapKey}
          ref={map}
          initialCenter={start}
          initialZoom={savedCamera?.zoom ?? START_ZOOM}
          features={features}
          selectedId={selected?.id ?? null}
          onSelect={(id) => setSelected(items.find((b) => b.id === id) ?? null)}
          onMapPress={() => setSelected(null)}
          onIdle={onIdle}
          showUser={userLoc !== null}
          onLoadError={() => setMapFailed(true)}
          onLoaded={() => setMapFailed(false)}
        />
      ) : null}

      {listMode ? (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface }]}
        >
          <BusinessList
            rows={rows}
            sort={effectiveSort}
            onSort={setSort}
            canSortByDistance={userLoc !== null}
            onOpen={openDetails}
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void listData.refetch().finally(() => setPulling(false));
            }}
            topInset={topHeight}
            header={
              <View style={styles.listTop}>
                {notices}
                <ThemedText type="bodyMedium" themeColor="onSurfaceVariant">
                  {userLoc
                    ? `Within ~${LIST_RADIUS_KM} km of you`
                    : `Within ~${LIST_RADIUS_KM} km of the map centre`}
                </ThemedText>
                {userLoc === null ? (
                  <View style={styles.link}>
                    <Button
                      title="Use my location to sort by distance"
                      variant="text"
                      icon="my_location"
                      loading={locating}
                      onPress={() => void recenter()}
                    />
                  </View>
                ) : null}
              </View>
            }
            empty={stateCard}
            bottomPadding={Spacing.four}
          />
        </View>
      ) : null}

      {/* Top overlay: bar + chips (+ map notices). */}
      <View
        style={[
          styles.top,
          { paddingTop: insets.top + Spacing.two },
          listMode && { backgroundColor: theme.surface },
        ]}
        pointerEvents="box-none"
        onLayout={(e) => setTopHeight(e.nativeEvent.layout.height)}
      >
        <DiscoverTopBar
          title={
            userLoc ? "Discover queues near you" : "Discover queues in Jammu"
          }
          view={listMode ? "list" : "map"}
          onView={(v) => {
            setView(v);
            setSelected(null);
          }}
          onScan={() => router.push("/scan")}
          category={category}
          onCategory={setCategory}
          openNow={openNow}
          onOpenNow={setOpenNow}
        />
      </View>

      {!listMode ? (
        <>
          <View
            style={[styles.mapNotices, { top: topHeight }]}
            pointerEvents="box-none"
          >
            {notices}
            {shown.isFetching && !firstLoad ? (
              <View
                style={[
                  styles.refreshing,
                  {
                    backgroundColor: theme.surfaceContainerHigh,
                    boxShadow: Elevation.level3,
                  },
                ]}
                accessibilityLabel="Refreshing"
              >
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : null}
            {stateCard && !selected ? (
              <View
                style={[
                  styles.stateCard,
                  { backgroundColor: theme.surfaceContainerLow },
                ]}
              >
                {stateCard}
              </View>
            ) : null}
          </View>

          <View style={styles.bottom} pointerEvents="box-none">
            <View style={styles.fab}>
              <Fab
                icon="my_location"
                accessibilityLabel="Show my location"
                loading={locating}
                onPress={() => void recenter()}
              />
            </View>
            {selected ? (
              <BusinessCard
                business={selected}
                onClose={() => setSelected(null)}
                onDetails={() => openDetails(selected.id)}
              />
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** A slim tonal strip (like the connection strip) for map and list notices. */
function Notice({ icon, text }: { icon: IconName; text: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.notice,
        { backgroundColor: theme.surfaceContainerHighest },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Icon name={icon} size={18} color="onSurfaceVariant" />
      <ThemedText type="bodyMedium" style={styles.fill}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  listTop: { gap: Spacing.two },
  link: { alignItems: "flex-start", marginLeft: -Spacing.twoHalf },
  mapNotices: {
    position: "absolute",
    left: Spacing.three,
    right: Spacing.three,
    gap: Spacing.two,
    alignItems: "stretch",
  },
  stateCard: { marginTop: Spacing.two, borderRadius: Radius.card },
  refreshing: {
    alignSelf: "center",
    borderRadius: Radius.full,
    padding: Spacing.two,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.twoHalf,
    paddingVertical: Spacing.two,
  },
  bottom: {
    position: "absolute",
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.three,
    gap: Spacing.twoHalf,
  },
  fab: { alignSelf: "flex-end" },
});
