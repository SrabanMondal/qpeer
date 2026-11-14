import type { Api } from "../../loadtest/lib/http.ts";
import { OWNER_SUB, type Signer } from "./jwt.ts";
import { log, must } from "./target.ts";

/** Answer shapes of the demo routes (packages/shared/src/demo.ts). */
export interface DemoQueue {
  id: string;
  name: string;
  businessId: string;
  businessName: string;
  businessIndex: number;
  lat: number;
  lng: number;
  priorityEnabled: boolean;
}

interface SeedAnswer {
  catalogSize: number;
  businessName: string;
  created: boolean;
  queues: DemoQueue[];
  ownersAdded: string[];
  ownersMissing: string[];
}

interface HistoryAnswer {
  analyticsRows: number;
  payments: number;
  ledgerRows: number;
}

export interface SeedOptions {
  weeks: number;
  seed: string;
  ownerPhones: string[];
  /** Skip the synthetic history (businesses and queues only). */
  noHistory: boolean;
}

/**
 * DEM-01…03: every catalogue business (one request each: business, queues,
 * owners), then its history (one request each). About 2 requests per
 * business; idempotent, so a re-run repairs a half-finished seed.
 */
export async function seedAll(
  api: Api,
  signer: Signer,
  o: SeedOptions,
): Promise<{ businesses: number; queues: number }> {
  const owner = signer.token(OWNER_SUB, { registered: true });
  let size = 1;
  let queues = 0;
  let rows = 0;
  let payments = 0;
  for (let i = 1; i <= size; i++) {
    const s = must(
      await api.req<SeedAnswer>("POST", "/v1/demo/seed", "/demo/seed", owner, {
        businessIndex: i,
        ownerPhones: o.ownerPhones,
      }),
      `seed business ${i}`,
    );
    size = s.catalogSize;
    queues += s.queues.length;
    if (i === 1 && o.ownerPhones.length > 0) {
      log(
        `owners added: ${s.ownersAdded.length}; not found (sign in on this environment once, then seed again): ${s.ownersMissing.length}`,
      );
    }
    if (o.noHistory) {
      log(`${i}/${size} ${s.businessName}: ${s.queues.length} queues`);
      continue;
    }
    const h = must(
      await api.req<HistoryAnswer>(
        "POST",
        "/v1/demo/seed/history",
        "/demo/seed/history",
        owner,
        { businessIndex: i, weeks: o.weeks, seed: o.seed },
      ),
      `history of business ${i}`,
    );
    rows += h.analyticsRows;
    payments += h.payments;
    log(
      `${i}/${size} ${s.businessName}: ${s.queues.length} queues, ${h.analyticsRows} hours, ${h.payments} payments`,
    );
  }
  log(
    `seeded ${size} businesses, ${queues} queues, ${rows} analytics rows, ${payments} payments`,
  );
  return { businesses: size, queues };
}

/** DEM-05: closes demo queues and deletes demo rows; retries while outboxes drain. */
export async function resetAll(
  api: Api,
  signer: Signer,
  wipeAll: boolean,
  maxMs = 120_000,
): Promise<void> {
  const owner = signer.token(OWNER_SUB, { registered: true });
  const until = Date.now() + maxMs;
  for (;;) {
    const r = await api.req<{
      done: boolean;
      closedQueues: number;
      pendingOutbox: number;
      deleted: Record<string, number>;
    }>("POST", "/v1/demo/reset", "/demo/reset", owner, { wipeAll });
    if (r.status === 200 && r.body.done) {
      const parts = Object.entries(r.body.deleted)
        .filter(([, n]) => n > 0)
        .map(([t, n]) => `${t} ${n}`);
      log(
        `reset: closed ${r.body.closedQueues} queues, deleted ${parts.join(", ") || "nothing"}`,
      );
      return;
    }
    if (r.status !== 409) must(r, "reset");
    if (Date.now() > until) {
      throw new Error(`reset: still draining after ${maxMs / 1000} s`);
    }
    log(
      `reset: ${r.body.closedQueues} queues closed, ${r.body.pendingOutbox} outbox items draining…`,
    );
    await new Promise((res) => setTimeout(res, 3_000));
  }
}
