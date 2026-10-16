import {
  DevSeedMapResponse,
  DevUnseedMapResponse,
  MapResponse,
} from "@qpeer/shared";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useAuth } from "@/lib/auth";

/** MAP-03: refresh the visible area this often while the map is on screen. */
export const MAP_REFRESH_MS = 30_000;

/** GET /v1/map?<query> — `query` from `mapQueryString()` (shared). */
export function getMap(query: string): Promise<MapResponse> {
  return apiFetch(`/v1/map?${query}`, MapResponse);
}

/**
 * Businesses in the visible box (MAP-01…04). `query` is null until the map
 * has reported its bounds. The previous box's answer stays on screen while a
 * new box loads (no flicker); refetches every 30 s while `live`.
 */
export function useMapBusinesses(query: string | null, live: boolean) {
  const uid = useAuth().user?.uid ?? null;
  return useQuery({
    queryKey: queryKeys.map(uid, query ?? ""),
    queryFn: () => getMap(query ?? ""),
    enabled: uid !== null && query !== null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: live ? MAP_REFRESH_MS : false,
    refetchIntervalInBackground: false,
  });
}

/** Dev only: POST /v1/dev/seed-map or /unseed-map, then reload the map. */
export function useDevMapSeed() {
  const uid = useAuth().user?.uid ?? null;
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.mapAll(uid) });
  const seed = useMutation({
    mutationFn: () =>
      apiFetch("/v1/dev/seed-map", DevSeedMapResponse, { method: "POST" }),
    onSuccess: refresh,
  });
  const unseed = useMutation({
    mutationFn: () =>
      apiFetch("/v1/dev/unseed-map", DevUnseedMapResponse, { method: "POST" }),
    onSuccess: refresh,
  });
  return { seed, unseed };
}
