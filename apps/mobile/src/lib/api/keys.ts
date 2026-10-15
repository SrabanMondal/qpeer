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
};
