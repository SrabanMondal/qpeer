import {
  type BusinessCategory,
  boxFromCorners,
  clampMapBox,
  type LatLng,
  type MapBox,
  type MapBusiness,
  type MapSort,
  mapQueryString,
  markerFeatures,
  sortBusinesses,
} from "@qpeer/shared";
import type { MapState } from "@rnmapbox/maps";
import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import {
  Button,
  Card,
  ConnectionBanner,
  EmptyState,
  ErrorState,
  Icon,
  type IconName,
  LoadingState,
} from "@/components/ui";
import { config } from "@/config";
import { Radius, Spacing } from "@/constants/theme";
import { useIsDark, useTheme } from "@/hooks/use-theme";
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
  const dark = useIsDark();
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

  const query = mapQueryString(box, { category, openNow });
  const data = useMapBusinesses(query, focused);
  const items = useMemo(() => data.data?.items ?? [], [data.data]);

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
    () => sortBusinesses(items, effectiveSort, userLoc),
    [items, effectiveSort, userLoc],
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

  const listMode = view === "list" || !hasToken;
  const filtersOn = category !== null || openNow;
  const firstLoad = data.isPending && data.fetchStatus === "fetching";
  const failedWithoutData = data.isError && !data.data;
  const empty = data.data !== undefined && items.length === 0;

  const notices = (
    <>
      <ConnectionBanner />
      {!hasToken ? (
        <Card>
          <ThemedText type="heading">Map not available</ThemedText>
          <ThemedText type="small" themeColor="inkMuted">
            Mapbox token missing: set EXPO_PUBLIC_MAPBOX_TOKEN in
            apps/mobile/.env.local (or the EAS environment) and restart Metro.
            The list still works.
          </ThemedText>
        </Card>
      ) : null}
      {clamped ? (
        <Notice
          icon="zoom_in"
          text="Zoom in to see queues across this whole area."
        />
      ) : null}
      {data.data?.truncated ? (
        <Notice
          icon="info"
          text="Showing the nearest 200. Zoom in to see more."
        />
      ) : null}
      {data.isError && data.data && !isNetworkError(data.error) ? (
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
    (offline && !data.data) || (mapFailed && !listMode) ? (
      <OfflineTicketsCard
        title={
          mapFailed && !offline
            ? "The map can't load"
            : "The map needs internet"
        }
        onRetry={() => {
          setMapFailed(false);
          setMapKey((k) => k + 1);
          void data.refetch();
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
      error={data.error}
      onRetry={() => void data.refetch()}
      retrying={data.isFetching}
    />
  ) : empty ? (
    <EmptyState
      icon="map"
      title={filtersOn ? "No matching queues here" : "No queues here yet"}
      message={
        filtersOn
          ? "Try All categories, turn off Open now, or move the map."
          : "Try zooming out or another area."
      }
      action={
        filtersOn ? (
          <Button
            title="Clear filters"
            variant="secondary"
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
    <View style={[styles.fill, { backgroundColor: theme.bg }]}>
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
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]}>
          <BusinessList
            rows={rows}
            sort={effectiveSort}
            onSort={setSort}
            canSortByDistance={userLoc !== null}
            onOpen={openDetails}
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void data.refetch().finally(() => setPulling(false));
            }}
            topInset={topHeight}
            header={
              <View style={styles.listTop}>
                {notices}
                {userLoc === null ? (
                  <Pressable
                    onPress={() => void recenter()}
                    accessibilityRole="button"
                    style={styles.link}
                  >
                    <ThemedText type="small" themeColor="primary">
                      Use my location to sort by distance
                    </ThemedText>
                  </Pressable>
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
          listMode && { backgroundColor: theme.bg },
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
            {data.isFetching && !firstLoad ? (
              <View
                style={[styles.refreshing, { backgroundColor: theme.card }]}
                accessibilityLabel="Refreshing"
              >
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : null}
            {stateCard && !selected ? (
              <View style={[styles.stateCard, { backgroundColor: theme.card }]}>
                {stateCard}
              </View>
            ) : null}
          </View>

          <View style={styles.bottom} pointerEvents="box-none">
            <Pressable
              onPress={() => void recenter()}
              accessibilityRole="button"
              accessibilityLabel="Show my location"
              style={({ pressed }) => [
                styles.fab,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  borderWidth: dark ? 1 : 0,
                  shadowColor: theme.shadow,
                },
                pressed && styles.dim,
              ]}
            >
              {locating ? (
                <ActivityIndicator color={theme.primary} />
              ) : (
                <Icon name="my_location" color="primary" />
              )}
            </Pressable>
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

function Notice({ icon, text }: { icon: IconName; text: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.notice,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Icon name={icon} size={18} color="inkMuted" />
      <ThemedText type="small" style={styles.fill}>
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
  link: { minHeight: 44, justifyContent: "center" },
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
    borderRadius: Radius.pill,
    padding: Spacing.two,
    elevation: 3,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: Radius.input,
    borderWidth: StyleSheet.hairlineWidth,
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
  fab: {
    alignSelf: "flex-end",
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  dim: { opacity: 0.6 },
});
