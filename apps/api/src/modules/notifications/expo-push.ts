import { type AlertKind, PUSH_CHANNEL_ID } from "@qpeer/shared";

/**
 * Expo Push API (architecture doc §11). Messages go out in batches of ≤ 100;
 * tickets are stored in `push_tickets`; the hourly cron checks receipts and
 * deletes devices that Expo reports as `DeviceNotRegistered`.
 */

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
export const EXPO_BATCH = 100;
const TIMEOUT_MS = 5_000;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: { tokenId: string; queueId: string; kind: AlertKind };
  channelId: string;
  priority: "high";
  sound: "default";
}

export type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message?: string; details?: { error?: string } };

export type ExpoReceipt =
  | { status: "ok" }
  | { status: "error"; message?: string; details?: { error?: string } };

/** The HTTP side of push, injectable so tests can record calls. */
export interface PushTransport {
  /** Sends ≤ 100 messages; returns one ticket per message, in order. */
  send(messages: ExpoMessage[]): Promise<ExpoTicket[]>;
  getReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>>;
}

export function expoTransport(accessToken?: string): PushTransport {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  async function post<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`expo push http ${res.status}`);
    const json = (await res.json()) as { data?: T };
    if (json.data === undefined) throw new Error("expo push: no data");
    return json.data;
  }

  return {
    send: (messages) => post<ExpoTicket[]>(SEND_URL, messages),
    getReceipts: (ids) =>
      post<Record<string, ExpoReceipt>>(RECEIPTS_URL, { ids }),
  };
}

/**
 * Process-wide override (tests only). The DO and the cron both read the
 * transport through `pushTransport(env)`.
 */
export const pushOverride: { transport: PushTransport | null } = {
  transport: null,
};

/** Prefix of the fake ticket ids written by the load-test sender. */
export const LOADTEST_TICKET_PREFIX = "loadtest-";

/**
 * Load-test sender (`ENVIRONMENT` = loadtest, Step 3.5): never calls Expo.
 * Every message gets an ok ticket `loadtest-<uuid>`, so `sendAlert` records one
 * `push_tickets` row per send (token, kind) — the loadtest stats endpoint
 * counts those rows. Receipts are always ok.
 */
export function loadtestTransport(): PushTransport {
  return {
    async send(messages) {
      return messages.map(
        (): ExpoTicket => ({
          status: "ok",
          id: `${LOADTEST_TICKET_PREFIX}${crypto.randomUUID()}`,
        }),
      );
    },
    async getReceipts(ids) {
      const out: Record<string, ExpoReceipt> = {};
      for (const id of ids) out[id] = { status: "ok" };
      return out;
    },
  };
}

/**
 * `env` may carry the optional `EXPO_ACCESS_TOKEN` secret (§17). In the
 * `loadtest` environment pushes are recorded, never sent.
 */
export function pushTransport(env: object): PushTransport {
  if (pushOverride.transport) return pushOverride.transport;
  if ((env as { ENVIRONMENT?: unknown }).ENVIRONMENT === "loadtest") {
    return loadtestTransport();
  }
  const token = (env as { EXPO_ACCESS_TOKEN?: unknown }).EXPO_ACCESS_TOKEN;
  return expoTransport(typeof token === "string" ? token : undefined);
}

export interface AlertPush {
  userId: string;
  tokenId: string;
  queueId: string;
  kind: AlertKind;
  title: string;
  body: string;
}

/**
 * Sends one alert to every registered device of the user and records tickets.
 * No devices = nothing to do. Throws on transport failure (the outbox retries).
 */
export async function sendAlert(
  d1: D1Database,
  transport: PushTransport,
  alert: AlertPush,
  now: number,
): Promise<number> {
  return sendAlerts(d1, transport, [alert], now);
}

/**
 * Sends several alerts with one device lookup, one Expo call per ≤ 100
 * messages and one ticket write per call, instead of two D1 round trips per
 * alert (a close or pause alerts every waiting token: Step 3.5 F2).
 */
export async function sendAlerts(
  d1: D1Database,
  transport: PushTransport,
  alerts: AlertPush[],
  now: number,
): Promise<number> {
  if (alerts.length === 0) return 0;
  const userIds = [...new Set(alerts.map((a) => a.userId))];
  const { results } = await d1
    .prepare(
      `SELECT user_id, expo_push_token FROM devices WHERE user_id IN (${userIds.map(() => "?").join(", ")})`,
    )
    .bind(...userIds)
    .all<{ user_id: string; expo_push_token: string }>();
  const devices = new Map<string, string[]>();
  for (const r of results) {
    const list = devices.get(r.user_id) ?? [];
    list.push(r.expo_push_token);
    devices.set(r.user_id, list);
  }
  const messages: ExpoMessage[] = [];
  for (const alert of alerts) {
    for (const to of devices.get(alert.userId) ?? []) {
      messages.push({
        to,
        title: alert.title,
        body: alert.body,
        data: {
          tokenId: alert.tokenId,
          queueId: alert.queueId,
          kind: alert.kind,
        },
        channelId: PUSH_CHANNEL_ID,
        priority: "high",
        sound: "default",
      });
    }
  }

  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const chunk = messages.slice(i, i + EXPO_BATCH);
    const tickets = await transport.send(chunk);
    const stmts: D1PreparedStatement[] = [];
    tickets.forEach((t, j) => {
      const m = chunk[j];
      if (t.status === "ok") {
        stmts.push(
          d1
            .prepare(
              `INSERT INTO push_tickets (id, token_id, expo_push_token, kind, sent_at, receipt_checked_at, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, NULL, 'sent', ?, ?) ON CONFLICT(id) DO NOTHING`,
            )
            .bind(t.id, m.data.tokenId, m.to, m.data.kind, now, now, now),
        );
      } else if (t.details?.error === "DeviceNotRegistered") {
        stmts.push(
          d1
            .prepare("DELETE FROM devices WHERE expo_push_token = ?")
            .bind(m.to),
        );
      }
    });
    if (stmts.length > 0) await d1.batch(stmts);
  }
  return messages.length;
}

export const RECEIPT_DELAY_MS = 15 * 60_000;
const RECEIPT_GIVE_UP_MS = 24 * 3_600_000;
const RECEIPT_BATCH = 300;

/**
 * Hourly cron: checks receipts of tickets older than 15 min and deletes devices
 * Expo reports as `DeviceNotRegistered`. Returns how many tickets were checked.
 */
export async function checkPushReceipts(
  d1: D1Database,
  transport: PushTransport,
  now: number,
): Promise<{ checked: number; removedDevices: number }> {
  const { results } = await d1
    .prepare(
      `SELECT id, expo_push_token, sent_at FROM push_tickets
       WHERE receipt_checked_at IS NULL AND sent_at <= ? ORDER BY sent_at LIMIT ?`,
    )
    .bind(now - RECEIPT_DELAY_MS, RECEIPT_BATCH)
    .all<{ id: string; expo_push_token: string; sent_at: number }>();
  if (results.length === 0) return { checked: 0, removedDevices: 0 };

  const receipts = await transport.getReceipts(results.map((r) => r.id));
  const stmts: D1PreparedStatement[] = [];
  let removedDevices = 0;
  for (const t of results) {
    const r = receipts[t.id];
    if (!r) {
      // Not ready yet: check again next hour. Expo keeps receipts ~24 h.
      if (t.sent_at < now - RECEIPT_GIVE_UP_MS) {
        stmts.push(
          d1
            .prepare(
              "UPDATE push_tickets SET receipt_checked_at = ?, status = 'no_receipt', updated_at = ? WHERE id = ?",
            )
            .bind(now, now, t.id),
        );
      }
      continue;
    }
    const status =
      r.status === "ok" ? "ok" : (r.details?.error ?? "error").slice(0, 60);
    stmts.push(
      d1
        .prepare(
          "UPDATE push_tickets SET receipt_checked_at = ?, status = ?, updated_at = ? WHERE id = ?",
        )
        .bind(now, status, now, t.id),
    );
    if (r.status === "error" && r.details?.error === "DeviceNotRegistered") {
      removedDevices++;
      stmts.push(
        d1
          .prepare("DELETE FROM devices WHERE expo_push_token = ?")
          .bind(t.expo_push_token),
      );
    }
  }
  if (stmts.length > 0) await d1.batch(stmts);
  return { checked: stmts.length - removedDevices, removedDevices };
}
