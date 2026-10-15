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

/** `env` may carry the optional `EXPO_ACCESS_TOKEN` secret (§17). */
export function pushTransport(env: object): PushTransport {
  if (pushOverride.transport) return pushOverride.transport;
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
  const { results } = await d1
    .prepare("SELECT expo_push_token FROM devices WHERE user_id = ?")
    .bind(alert.userId)
    .all<{ expo_push_token: string }>();
  const targets = results.map((r) => r.expo_push_token);
  if (targets.length === 0) return 0;

  let sent = 0;
  for (let i = 0; i < targets.length; i += EXPO_BATCH) {
    const chunk = targets.slice(i, i + EXPO_BATCH);
    const messages: ExpoMessage[] = chunk.map((to) => ({
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
    }));
    const tickets = await transport.send(messages);
    const stmts: D1PreparedStatement[] = [];
    tickets.forEach((t, j) => {
      const to = chunk[j];
      if (t.status === "ok") {
        stmts.push(
          d1
            .prepare(
              `INSERT INTO push_tickets (id, token_id, expo_push_token, kind, sent_at, receipt_checked_at, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, NULL, 'sent', ?, ?) ON CONFLICT(id) DO NOTHING`,
            )
            .bind(t.id, alert.tokenId, to, alert.kind, now, now, now),
        );
      } else if (t.details?.error === "DeviceNotRegistered") {
        stmts.push(
          d1.prepare("DELETE FROM devices WHERE expo_push_token = ?").bind(to),
        );
      }
    });
    if (stmts.length > 0) await d1.batch(stmts);
    sent += messages.length;
  }
  return sent;
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
