import {
  focusManager,
  MutationCache,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

import { ApiError, isNetworkError } from "@/lib/api/client";

/**
 * B1: one QueryClient for the app, with network-aware retries and a tiny
 * "offline" store for the banner. No native module needed (no NetInfo):
 * the app learns it is offline from failed requests and online again from
 * the next successful one.
 */

const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Network errors retry forever with backoff (the app must recover by itself);
 * 4xx answers never retry; other failures (5xx, bad JSON) retry twice.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isNetworkError(error)) return true;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

/** 1 s, 2 s, 4 s, 8 s, 16 s, then every 30 s. */
export function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

// --- Offline store ---------------------------------------------------------

let offline = false;
const listeners = new Set<() => void>();

function setOffline(next: boolean) {
  if (offline === next) return;
  offline = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while the latest requests failed because the API was unreachable. */
export function useOffline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => offline,
    () => offline,
  );
}

// --- Query client ------------------------------------------------------------

export function createQueryClient(): QueryClient {
  const queryCache = new QueryCache();
  const client = new QueryClient({
    queryCache,
    mutationCache: new MutationCache(),
    defaultOptions: {
      queries: { retry: shouldRetry, retryDelay, staleTime: 30_000 },
    },
  });

  // Only query outcomes drive the banner: queries keep retrying, so a later
  // success always clears it. A failed mutation is reported by its screen.
  queryCache.subscribe((event) => {
    if (event.type !== "updated") return;
    const { action } = event;
    if (
      (action.type === "failed" || action.type === "error") &&
      isNetworkError(action.error)
    ) {
      setOffline(true);
    } else if (action.type === "success" && !action.manual && offline) {
      setOffline(false);
      // The connection is back: retry the other waiting queries now instead
      // of after their (up to 30 s) backoff. Runs once per offline → online.
      setTimeout(() => retryNetworkFailures(client), 0);
    }
  });

  return client;
}

/**
 * Restarts queries that are waiting to retry after a network error (banner
 * Retry, app back in the foreground, connection back). Each query restarts
 * once; queries that are fine are not touched.
 */
export function retryNetworkFailures(client: QueryClient) {
  void client.refetchQueries(
    {
      predicate: (query) =>
        query.state.fetchFailureCount > 0 &&
        isNetworkError(query.state.fetchFailureReason),
    },
    { cancelRefetch: true },
  );
}

/**
 * TanStack Query on React Native: treat "app in the foreground" as window
 * focus, so stale queries refetch when the user comes back, retries pause in
 * the background, and queries stuck on a network error restart at once.
 */
export function useAppFocusRefetch(client: QueryClient) {
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (status) => {
      const active = status === "active";
      focusManager.setFocused(active);
      if (active) retryNetworkFailures(client);
    });
    return () => sub.remove();
  }, [client]);
}
