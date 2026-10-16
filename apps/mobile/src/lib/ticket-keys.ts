import {
  publicTicketKeys,
  TicketKeysResponse,
  type TicketPublicJwk,
} from "@qpeer/shared";
import { useEffect } from "react";

import { config } from "@/config";
import bundled from "@/constants/ticket-public-keys.json";
import { readStored, useStored, writeStored } from "@/lib/storage";

/**
 * C3: public keys that verify signed tickets offline. The app ships a copy
 * (`constants/ticket-public-keys.json`, written by
 * `scripts/ticket-keys/gen-key.ts --app`) and refreshes it from the public
 * `GET /v1/ticket-keys` when online, keeping the last answer on the phone.
 */

const BUNDLED: TicketPublicJwk[] = publicTicketKeys(bundled);
/** Refetch the keys at most this often. */
const REFRESH_MS = 6 * 3_600_000;

/** Fetched keys first, then bundled ones not already in the list. */
function merge(fetched: TicketPublicJwk[] | undefined): TicketPublicJwk[] {
  const out = [...(fetched ?? [])];
  for (const k of BUNDLED) {
    if (!out.some((x) => x.kid === k.kid)) out.push(k);
  }
  return out;
}

let refreshing: Promise<void> | null = null;

/** Refreshes the cached keys when stale; silent on any failure (offline). */
export function refreshTicketKeys(force = false): Promise<void> {
  refreshing ??= (async () => {
    try {
      const cached = await readStored("ticketKeys");
      if (!force && cached && Date.now() - cached.fetchedAt < REFRESH_MS) {
        return;
      }
      const res = await fetch(`${config.apiUrl}/v1/ticket-keys`);
      if (!res.ok) return;
      const parsed = TicketKeysResponse.safeParse(await res.json());
      if (parsed.success) {
        await writeStored("ticketKeys", {
          keys: parsed.data.keys,
          fetchedAt: Date.now(),
        });
      }
    } catch {
      // Offline: keep what we have.
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Keys to verify with (cached + bundled); refreshes in the background. */
export function useTicketKeys(): TicketPublicJwk[] {
  const { value } = useStored("ticketKeys");
  useEffect(() => {
    void refreshTicketKeys();
  }, []);
  return merge(value?.keys);
}
