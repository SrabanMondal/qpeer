import { env } from "cloudflare:workers";
import {
  defaultWeeklyHours,
  LiveMessage,
  type QueueSettings,
  QueueSettings as QueueSettingsSchema,
} from "@qpeer/shared";
import { expect } from "vitest";
import { db } from "../src/db/client";
import { businesses, businessMembers, queues } from "../src/db/schema";
import type {
  ExpoMessage,
  ExpoReceipt,
  ExpoTicket,
  PushTransport,
} from "../src/modules/notifications/expo-push";
import type { DoResult } from "../src/queue/queue-do";

export const JAMMU = { lat: 32.7266, lng: 74.857 };
export const MIN = 60_000;

export function stubFor(queueId: string) {
  return env.QUEUE.get(env.QUEUE.idFromName(queueId));
}

/** D1 business + queue rows (so snapshots can join the business) and an initialised DO. */
export async function seedQueue(
  opts: {
    settings?: Partial<QueueSettings>;
    ownerUserId?: string;
    open?: boolean;
  } = {},
) {
  const businessId = crypto.randomUUID();
  const queueId = crypto.randomUUID();
  const now = new Date();
  const settings = QueueSettingsSchema.parse(opts.settings ?? {});
  const owner = opts.ownerUserId ?? `owner-${businessId}`;
  await db(env.DB).batch([
    db(env.DB).insert(businesses).values({
      id: businessId,
      ownerUserId: owner,
      name: "Test Clinic",
      category: "clinic",
      address: "Jammu",
      lat: JAMMU.lat,
      lng: JAMMU.lng,
      geohash: "x",
      hoursJson: defaultWeeklyHours(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
    db(env.DB).insert(businessMembers).values({
      businessId,
      userId: owner,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    }),
    db(env.DB).insert(queues).values({
      id: queueId,
      businessId,
      name: "OPD",
      status: "active",
      settingsJson: settings,
      settingsVersion: 1,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  const stub = stubFor(queueId);
  await stub.init({
    queueId,
    businessId,
    settings,
    settingsVersion: 1,
    queueName: "OPD",
    businessName: "Test Clinic",
  });
  if (opts.open !== false) must(await stub.open());
  return { businessId, queueId, stub };
}

/** Asserts an ok DO result and returns its value. */
export function must<T>(r: DoResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r.value;
}

/** Asserts a failed DO result with this code. */
export function mustFail<T>(r: DoResult<T>, code: string) {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe(code);
  return r;
}

/** Records every Expo call; tickets are ok unless a token is marked dead. */
export function fakePush() {
  const sent: ExpoMessage[] = [];
  const dead = new Set<string>();
  const receipts: Record<string, ExpoReceipt> = {};
  let failSends = 0;
  const transport: PushTransport = {
    async send(messages) {
      if (failSends > 0) {
        failSends--;
        throw new Error("simulated expo outage");
      }
      sent.push(...messages);
      return messages.map(
        (m): ExpoTicket =>
          dead.has(m.to)
            ? {
                status: "error",
                message: "not registered",
                details: { error: "DeviceNotRegistered" },
              }
            : { status: "ok", id: crypto.randomUUID() },
      );
    },
    async getReceipts(ids) {
      const out: Record<string, ExpoReceipt> = {};
      for (const id of ids) if (receipts[id]) out[id] = receipts[id];
      return out;
    },
  };
  return {
    transport,
    sent,
    dead,
    receipts,
    failNextSends(n: number) {
      failSends = n;
    },
    kinds(tokenId: string) {
      return sent
        .filter((m) => m.data.tokenId === tokenId)
        .map((m) => m.data.kind);
    },
  };
}

export async function addDevice(userId: string, token: string) {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO devices (expo_push_token, user_id, platform, last_seen_at, created_at, updated_at) VALUES (?, ?, 'android', ?, ?, ?)",
  )
    .bind(token, userId, now, now, now)
    .run();
}

/** Opens a socket on the DO (or a Worker response) and collects parsed messages. */
export function collect(res: Response) {
  const ws = res.webSocket;
  if (!ws) throw new Error(`no webSocket on response (status ${res.status})`);
  ws.accept();
  const messages: LiveMessage[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(LiveMessage.parse(JSON.parse(String(e.data))));
  });
  return { ws, messages };
}

export async function waitFor<T>(
  fn: () => T | undefined | null | false,
  timeoutMs = 3000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
