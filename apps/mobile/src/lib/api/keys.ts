/**
 * TanStack Query keys. Everything except `me` is scoped by Firebase uid, so a
 * sign-out or account switch never shows another user's cached data.
 */
export const queryKeys = {
  /** Prefix for every `/v1/me` entry of one user. */
  meAll: (uid: string | null) => ["me", uid] as const,
  /** The provider part refetches after linking Google/phone (same uid, new providers). */
  me: (uid: string | null, provider: string) => ["me", uid, provider] as const,
  myBusinesses: (uid: string | null) => ["businesses", uid, "mine"] as const,
  business: (uid: string | null, id: string) => ["business", uid, id] as const,
  queue: (uid: string | null, id: string) => ["queue", uid, id] as const,
  /** Staff console state of one queue (Step 2). */
  console: (uid: string | null, queueId: string) =>
    ["console", uid, queueId] as const,
  token: (uid: string | null, id: string) => ["token", uid, id] as const,
  /** Prefix for every `/v1/map` box (Step 3). */
  mapAll: (uid: string | null) => ["map", uid] as const,
  /** One `/v1/map` request: its query string carries the box and filters. */
  map: (uid: string | null, query: string) => ["map", uid, query] as const,
  /** Prefix for both "My tokens" lists. */
  myTokensAll: (uid: string | null) => ["tokens", uid, "mine"] as const,
  myTokens: (uid: string | null, status: "active" | "recent") =>
    ["tokens", uid, "mine", status] as const,
};
