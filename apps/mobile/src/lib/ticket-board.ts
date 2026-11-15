import type { TokenView } from "@qpeer/shared";

import type { BoardRow, BoardTone } from "@/components/ui/token-board";
import { boardNumber, spell } from "@/components/ui/token-board";
import { formatClock, formatCountdown } from "@/lib/queue-format";

export type TicketBoard = {
  top: BoardRow;
  number: string;
  numberTone: BoardTone;
  bottom: BoardRow | null;
  /** The whole board in words, for screen readers. */
  label: string;
  /** Set while the ticket is called; a change re-lights the board. */
  relightKey: string | null;
};

/** "m:ss" → "4 minutes 12 seconds", for screen readers. */
function spokenCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const parts = [];
  if (m > 0) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
  if (r > 0 || m === 0) parts.push(`${r} ${r === 1 ? "second" : "seconds"}`);
  return parts.join(" ");
}

/**
 * What the customer's token board shows in each ticket state (design guide
 * §5a): LED rows in capitals, the number padded ("014"), red LEDs only when
 * it is time to come ("YOUR TURN", "COME NOW m:ss"). Words for the screen
 * reader say the same thing in one sentence.
 */
export function ticketBoard(t: TokenView, now: number): TicketBoard {
  const code = t.checkCode ?? null;
  const codeRow = code
    ? { right: code, rightTone: "dim" as const, rightSelectable: true }
    : {};
  const codeWords = code ? ` Check code ${spell(code)}.` : "";
  const number = boardNumber(t.label);
  const priority = (t.lane ?? t.cls) === "priority";
  const counter = t.counter !== null ? `COUNTER ${t.counter}` : "THE COUNTER";
  const counterWords =
    t.counter !== null ? `counter ${t.counter}` : "the counter";
  const serving = t.nowServing ? boardNumber(t.nowServing) : "---";
  const servingWords = t.nowServing
    ? `Now serving ${t.nowServing}.`
    : "Nobody is being served yet.";

  switch (t.state) {
    case "BOOKED":
      return {
        top: { left: "PRIORITY PASS", ...codeRow },
        number: "P--",
        numberTone: "dim",
        bottom: { left: "CHECK IN", right: "ON ARRIVAL" },
        label: `Priority Pass, booked.${codeWords} You get your P number when you check in.`,
        relightKey: null,
      };
    case "CALLED":
      return {
        top: {
          left: "YOUR TURN",
          leftTone: "alert",
          right: "NOW",
          rightTone: "alert",
        },
        number,
        numberTone: "led",
        bottom: { left: "GO TO", right: counter },
        label: `It's your turn. Token ${t.label}.${codeWords} Go to ${counterWords} now.`,
        relightKey: "CALLED",
      };
    case "GRACE": {
      const ends = t.graceEndsAt ?? t.graceUntil;
      const left = ends !== null ? ends - now : 0;
      return {
        top: {
          left: "COME NOW",
          leftTone: "alert",
          right: left > 0 ? formatCountdown(left) : null,
          rightTone: "alert",
        },
        number,
        numberTone: "led",
        bottom: { left: "GO TO", right: counter },
        label: `Come now. Token ${t.label}.${codeWords} ${
          left > 0 ? `${spokenCountdown(left)} left. ` : ""
        }Go to ${counterWords}.`,
        relightKey: "GRACE",
      };
    }
    case "MISSED":
      return {
        top: { left: "TURN MISSED", ...codeRow },
        number,
        numberTone: "dim",
        bottom:
          t.rejoinAvailable !== false && t.rejoinUntil
            ? {
                left: "REJOIN BY",
                right: formatClock(t.rejoinUntil).toUpperCase(),
              }
            : null,
        label: `Token ${t.label}. You missed your turn.${codeWords}`,
        relightKey: null,
      };
    case "WAITING": {
      const paused = t.queueStatus === "paused";
      const closed = t.queueStatus === "closed";
      return {
        top: { left: priority ? "PRIORITY LANE" : "YOUR TOKEN", ...codeRow },
        number,
        numberTone: "led",
        bottom: closed
          ? {
              left: "QUEUE CLOSED",
              right: "NUMBER KEPT",
              leftTone: "dim",
              rightTone: "dim",
            }
          : paused
            ? {
                left: "QUEUE PAUSED",
                right: "PLACE KEPT",
                leftTone: "dim",
                rightTone: "dim",
              }
            : { left: "NOW SERVING", right: serving },
        label: `Your token ${t.label}${priority ? ", priority lane" : ""}.${codeWords} ${
          closed
            ? "The queue is closed; your number is kept."
            : paused
              ? "The queue is paused; your place is kept."
              : servingWords
        }`,
        relightKey: null,
      };
    }
    default: {
      const word =
        t.state === "SERVED"
          ? "SERVED"
          : t.state === "LEFT"
            ? "LEFT QUEUE"
            : t.state === "CANCELLED"
              ? "CANCELLED"
              : "TOKEN ENDED";
      return {
        top: { left: word, leftTone: "dim" },
        number,
        numberTone: "dim",
        bottom: null,
        label: `Token ${t.label}. ${
          t.state === "SERVED"
            ? "Served."
            : t.state === "LEFT"
              ? "You left the queue."
              : t.state === "CANCELLED"
                ? "Cancelled."
                : "This ticket has ended."
        }`,
        relightKey: null,
      };
    }
  }
}
