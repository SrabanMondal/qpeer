import { LIVE_PING, LiveMessage } from "@qpeer/shared";
import { getAuth, getIdToken } from "@react-native-firebase/auth";
import { useEffect, useEffectEvent, useState } from "react";
import { AppState } from "react-native";

import { config } from "@/config";

/**
 * Live updates over the queue WebSocket (architecture §9.9, TOK-02).
 *
 * - Auth: `Authorization: Bearer <Firebase ID token>` on the upgrade request
 *   (React Native's `new WebSocket(url, protocols, { headers })`); never a
 *   token in the URL.
 * - Heartbeat: `{"type":"ping"}` every 30 s; if nothing comes back for 75 s
 *   the socket is treated as dead and replaced.
 * - Reconnects with backoff 1 s → 30 s; closes while the app is in the
 *   background and reconnects when it comes back.
 * - `onOpen` runs after every (re)connect so the screen refetches over HTTP:
 *   the socket is a fast path, never the only path.
 */

const PING_EVERY_MS = 30_000;
const DEAD_AFTER_MS = 75_000;
const MAX_BACKOFF_MS = 30_000;

export type LiveStatus = "connecting" | "live" | "off";

/**
 * React Native 0.86's WebSocket takes a third `options` argument with
 * `headers` (Libraries/WebSocket/WebSocket.js). The DOM typings the app is
 * checked with only know two arguments, hence this typed alias.
 */
type NativeWebSocketCtor = new (
  url: string,
  protocols: string | string[] | null,
  options: { headers: Record<string, string> },
) => WebSocket;
const NativeWebSocket = WebSocket as unknown as NativeWebSocketCtor;

/** `wss://<api host>/v1/queues/:id/live?<query>` */
export function liveUrl(queueId: string, query: string): string {
  const base = config.apiUrl.replace(/^http/i, "ws");
  return `${base}/v1/queues/${encodeURIComponent(queueId)}/live?${query}`;
}

export function useLiveSocket(opts: {
  queueId: string | null;
  /** `tokenId=<id>` (token owner) or `console=1` (staff). */
  query: string;
  enabled: boolean;
  onMessage: (message: LiveMessage) => void;
  onOpen: () => void;
}): LiveStatus {
  const { queueId, query, enabled } = opts;
  const [status, setStatus] = useState<LiveStatus>("off");
  // Latest callbacks without reconnecting when they change.
  const handleMessage = useEffectEvent((m: LiveMessage) => opts.onMessage(m));
  const handleOpen = useEffectEvent(() => opts.onOpen());

  useEffect(() => {
    if (!enabled || !queueId) {
      setStatus("off");
      return;
    }
    let disposed = false;
    let foreground = AppState.currentState !== "background";
    let socket: WebSocket | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let lastHeard = 0;

    const clearTimers = () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      retryTimer = null;
      pingTimer = null;
    };

    const dropSocket = () => {
      const s = socket;
      socket = null;
      if (!s) return;
      s.onopen = null;
      s.onmessage = null;
      s.onerror = null;
      s.onclose = null;
      try {
        s.close();
      } catch {
        // Already closed.
      }
    };

    const scheduleReconnect = () => {
      if (disposed || !foreground || retryTimer) return;
      const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
      attempt += 1;
      setStatus("connecting");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (disposed || !foreground) return;
      dropSocket();
      setStatus("connecting");
      const user = getAuth().currentUser;
      let token: string;
      try {
        if (!user) throw new Error("no user");
        token = await getIdToken(user);
      } catch {
        scheduleReconnect();
        return;
      }
      if (disposed || !foreground) return;

      const ws = new NativeWebSocket(liveUrl(queueId, query), null, {
        headers: { Authorization: `Bearer ${token}` },
      });
      socket = ws;

      ws.onopen = () => {
        if (socket !== ws) return;
        attempt = 0;
        lastHeard = Date.now();
        setStatus("live");
        handleOpen();
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (socket !== ws) return;
          if (Date.now() - lastHeard > DEAD_AFTER_MS) {
            // No pong: the connection is gone without a close event.
            dropSocket();
            if (pingTimer) clearInterval(pingTimer);
            pingTimer = null;
            scheduleReconnect();
            return;
          }
          try {
            ws.send(LIVE_PING);
          } catch {
            // The close handler reconnects.
          }
        }, PING_EVERY_MS);
      };

      ws.onmessage = (event) => {
        if (socket !== ws) return;
        lastHeard = Date.now();
        if (typeof event.data !== "string") return;
        let json: unknown;
        try {
          json = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = LiveMessage.safeParse(json);
        if (!parsed.success || parsed.data.type === "pong") return;
        handleMessage(parsed.data);
      };

      ws.onerror = () => {
        // A close event follows; reconnect there.
      };

      ws.onclose = () => {
        if (socket !== ws) return;
        socket = null;
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        scheduleReconnect();
      };
    };

    const appState = AppState.addEventListener("change", (next) => {
      const nowForeground = next === "active";
      if (nowForeground === foreground) return;
      foreground = nowForeground;
      if (foreground) {
        attempt = 0;
        clearTimers();
        void connect();
      } else {
        // Save battery and server sockets; refetch + reconnect on return.
        clearTimers();
        dropSocket();
        setStatus("off");
      }
    });

    void connect();

    return () => {
      disposed = true;
      appState.remove();
      clearTimers();
      dropSocket();
    };
  }, [enabled, queueId, query]);

  return status;
}
