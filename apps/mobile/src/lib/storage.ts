import {
  AnalyticsResponse,
  BusinessCategory,
  EarningsResponse,
  isActiveState,
  TicketPublicJwk,
  TokenView,
} from "@qpeer/shared";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState, useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * Small typed key–value store on the phone (C1), on top of AsyncStorage
 * (SQLite on Android; no config plugin). Every key has a zod schema and a
 * version: a value written by another app version, a half-written value or
 * plain garbage reads as "missing", never as a crash. Values are cached in
 * memory, and `useStored` re-renders when a value changes.
 *
 * Nothing secret and no coordinates are stored here (the map camera is the
 * map's view, not the user's position).
 */

const PREFIX = "qpeer:";

/** A saved ticket: the last view the server sent, and when (C1, C3). */
export const SavedTicket = z.object({
  view: TokenView,
  /** Phone time when the view was received. */
  savedAt: z.number(),
});
export type SavedTicket = z.infer<typeof SavedTicket>;

export const MapPrefs = z.object({
  category: BusinessCategory.nullable(),
  openNow: z.boolean(),
  sort: z.enum(["distance", "wait", "name"]),
  view: z.enum(["map", "list"]),
});
export type MapPrefs = z.infer<typeof MapPrefs>;

export const MapCamera = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  zoom: z.number().min(0).max(24),
});
export type MapCamera = z.infer<typeof MapCamera>;

export const InsightsPrefs = z.object({
  businessId: z.string().nullable(),
  range: z.union([z.literal(7), z.literal(28)]),
  queueId: z.string().nullable(),
});
export type InsightsPrefs = z.infer<typeof InsightsPrefs>;

export const SavedInsights = z.object({
  analytics: AnalyticsResponse,
  earnings: EarningsResponse.nullable(),
  savedAt: z.number(),
});
export type SavedInsights = z.infer<typeof SavedInsights>;

/** Every key: its schema and version. Bump `v` when the shape changes. */
const KEYS = {
  /** Tickets per Firebase uid, by token id. */
  tickets: {
    v: 1,
    schema: z.record(z.string(), z.record(z.string(), SavedTicket)),
  },
  /** ALR-06 battery tip dismissed. */
  batteryTipDismissed: { v: 1, schema: z.boolean() },
  /** Console: last chosen queue id. */
  consoleQueue: { v: 1, schema: z.string() },
  mapPrefs: { v: 1, schema: MapPrefs },
  mapCamera: { v: 1, schema: MapCamera },
  /** C3: public keys fetched from GET /v1/ticket-keys. */
  ticketKeys: {
    v: 1,
    schema: z.object({
      keys: z.array(TicketPublicJwk),
      fetchedAt: z.number(),
    }),
  },
  /** Step 5: the Insights tab's last choices. */
  insightsPrefs: { v: 1, schema: InsightsPrefs },
  /**
   * Step 5: last answers per (uid, business, range, queue), so Insights opens
   * offline with what was seen last (a few entries only).
   */
  insightsCache: {
    v: 1,
    schema: z.record(z.string(), SavedInsights),
  },
} as const;

export type StorageKey = keyof typeof KEYS;
export type StoredValue<K extends StorageKey> = z.infer<
  (typeof KEYS)[K]["schema"]
>;

const cache = new Map<StorageKey, unknown>();
const loaded = new Set<StorageKey>();
const listeners = new Map<StorageKey, Set<() => void>>();

function notify(key: StorageKey) {
  for (const l of listeners.get(key) ?? []) l();
}

function parse<K extends StorageKey>(
  key: K,
  raw: string | null,
): StoredValue<K> | undefined {
  if (raw === null) return undefined;
  try {
    const box = JSON.parse(raw) as { v?: unknown; data?: unknown };
    if (box?.v !== KEYS[key].v) return undefined;
    const r = KEYS[key].schema.safeParse(box.data);
    return r.success ? (r.data as StoredValue<K>) : undefined;
  } catch {
    return undefined;
  }
}

/** The stored value, or undefined when missing, old or unreadable. */
export async function readStored<K extends StorageKey>(
  key: K,
): Promise<StoredValue<K> | undefined> {
  if (loaded.has(key)) return cache.get(key) as StoredValue<K> | undefined;
  let value: StoredValue<K> | undefined;
  try {
    value = parse(key, await AsyncStorage.getItem(PREFIX + key));
  } catch {
    value = undefined;
  }
  // A write that happened while we were reading wins.
  if (!loaded.has(key)) {
    cache.set(key, value);
    loaded.add(key);
    notify(key);
  }
  return cache.get(key) as StoredValue<K> | undefined;
}

/** Loads every key into memory (called once at app start). */
export function preloadStorage(): Promise<void> {
  return Promise.all(
    (Object.keys(KEYS) as StorageKey[]).map((k) => readStored(k)),
  ).then(() => undefined);
}

/** Last known value without waiting (undefined until loaded). */
export function peekStored<K extends StorageKey>(
  key: K,
): StoredValue<K> | undefined {
  return cache.get(key) as StoredValue<K> | undefined;
}

/** Writes (or with `undefined`, removes) a value. Never throws. */
export async function writeStored<K extends StorageKey>(
  key: K,
  value: StoredValue<K> | undefined,
): Promise<void> {
  cache.set(key, value);
  loaded.add(key);
  notify(key);
  try {
    if (value === undefined) await AsyncStorage.removeItem(PREFIX + key);
    else {
      await AsyncStorage.setItem(
        PREFIX + key,
        JSON.stringify({ v: KEYS[key].v, data: value }),
      );
    }
  } catch {
    // Storage full or unavailable: the in-memory value still works this run.
  }
}

/** Reads and writes a value from React; `ready` is false until loaded. */
export function useStored<K extends StorageKey>(
  key: K,
): {
  value: StoredValue<K> | undefined;
  ready: boolean;
  set: (v: StoredValue<K> | undefined) => void;
} {
  const value = useSyncExternalStore(
    (cb) => {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
      };
    },
    () => cache.get(key) as StoredValue<K> | undefined,
  );
  const [ready, setReady] = useState(loaded.has(key));
  useEffect(() => {
    let alive = true;
    void readStored(key).then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return {
    value,
    ready: ready || loaded.has(key),
    set: (v) => void writeStored(key, v),
  };
}

// ---------- tickets (C1) ----------

/** Ended tickets stay saved this long (so "you were served" still shows). */
const ENDED_KEEP_MS = 24 * 3_600_000;
/** At most this many tickets per user are kept. */
const MAX_TICKETS = 30;

/**
 * Saves the newest view of a ticket for `uid` (keeps a known signed ticket
 * when the new view has none, e.g. from the socket). Old ended tickets are
 * pruned on the way.
 */
export async function saveTicketView(
  uid: string,
  view: TokenView,
  now = Date.now(),
): Promise<void> {
  const all = (await readStored("tickets")) ?? {};
  const mine = { ...(all[uid] ?? {}) };
  const old = mine[view.id];
  if (old && old.view.rev > view.rev) return;
  mine[view.id] = {
    view: {
      ...view,
      signedTicket: view.signedTicket ?? old?.view.signedTicket ?? null,
    },
    savedAt: now,
  };
  // Step 4: BOOKED passes and MISSED tickets are active too (they keep their
  // check code, validity and rejoin time for the offline view).
  const kept = Object.values(mine)
    .filter(
      (t) => isActiveState(t.view.state) || now - t.savedAt < ENDED_KEEP_MS,
    )
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_TICKETS);
  await writeStored("tickets", {
    ...all,
    [uid]: Object.fromEntries(kept.map((t) => [t.view.id, t])),
  });
}

/** The saved tickets of `uid`, newest first; active first. */
export function useSavedTickets(uid: string | null): {
  tickets: SavedTicket[];
  ready: boolean;
} {
  const { value, ready } = useStored("tickets");
  const mine = uid ? Object.values(value?.[uid] ?? {}) : [];
  const active = (t: SavedTicket) => (isActiveState(t.view.state) ? 0 : 1);
  mine.sort((a, b) => active(a) - active(b) || b.savedAt - a.savedAt);
  return { tickets: mine, ready };
}

/** One saved ticket of `uid`, or undefined. */
export function useSavedTicket(
  uid: string | null,
  tokenId: string,
): SavedTicket | undefined {
  const { value } = useStored("tickets");
  return uid ? value?.[uid]?.[tokenId] : undefined;
}
