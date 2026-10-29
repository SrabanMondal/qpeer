import type { AlertKind, LiveMessage } from "@qpeer/shared";

/**
 * WebSocket protocol (architecture doc §9.9). Message shapes are the shared
 * `LiveMessage` zod union; heartbeat is the Hibernation auto-response
 * `{"type":"ping"}` → `{"type":"pong"}` (set in the DO constructor).
 */
export { LIVE_PING, LIVE_PONG } from "@qpeer/shared";

/** Sockets attached to a token get `token` messages; console sockets get `queue`. */
export type SocketAttachment =
  | { kind: "token"; tokenId: string }
  | { kind: "console" };

export const tokenTag = (tokenId: string) => `t:${tokenId}`;
export const CONSOLE_TAG = "console";

/** Tokens within this many positions get every update; others at most every 30 s. */
export const NEAR_POSITIONS = 20;

export function encode(msg: LiveMessage): string {
  return JSON.stringify(msg);
}

/** Alert bits in `tokens.alert_flags` (ALR-04: each kind at most once per token). */
export const ALERT_BITS: Record<AlertKind, number> = {
  head_back: 1,
  next: 2,
  called: 4,
  grace_started: 8,
  queue_paused: 16,
  queue_closed: 32,
  refund_issued: 64,
  missed: 128,
};

/** Head-back alert lead: fire when the expected call is this close. */
export const HEAD_BACK_LEAD_MS = 15 * 60_000;
/** No head-back alert in the first minutes after joining (walk-ins are on site). */
export const HEAD_BACK_MIN_AGE_MS = 10 * 60_000;

/** English push texts (the app shows its own text in-app from `kind`). */
export function alertText(
  kind: AlertKind,
  ctx: { queueName: string; counter: number | null; graceMinutes: number },
): { title: string; body: string } {
  switch (kind) {
    case "head_back":
      return {
        title: "Time to head back",
        body: `Your turn at ${ctx.queueName} is coming up soon.`,
      };
    case "next":
      return { title: "You're next", body: `You're next at ${ctx.queueName}.` };
    case "called":
      return {
        title: "It's your turn",
        body:
          ctx.counter !== null
            ? `Please go to counter ${ctx.counter} now.`
            : "Please go to the counter now.",
      };
    case "grace_started":
      // HLD §5.2 step 1: "you were called, come now".
      return {
        title: "You were called — come now",
        body: `Reach the counter within ${ctx.graceMinutes} min to keep your place.`,
      };
    case "missed":
      // ALR-08 (R3, decided 2026-10-18).
      return {
        title: "You missed your turn",
        body: "You missed your turn. Tap I'm here when you arrive.",
      };
    case "queue_paused":
      return {
        title: "Queue paused",
        body: `${ctx.queueName} is paused. Your place is kept.`,
      };
    case "queue_closed":
      return {
        title: "Queue closed",
        body: `${ctx.queueName} has closed for today.`,
      };
    case "refund_issued":
      return { title: "Refund issued", body: "Your refund is on its way." };
  }
}
