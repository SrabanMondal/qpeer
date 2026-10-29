import { ApiError } from "@/lib/api/client";
import { errorText } from "@/lib/error-messages";
import type { LocationProblem } from "@/lib/join-location";
import { formatDateTime, formatDistance } from "@/lib/queue-format";

/** What the join screen shows when a join cannot go ahead (JON-05, JON-06, JON-07). */
export type JoinProblem = {
  title: string;
  message: string;
  /** The fix the main button offers. */
  fix:
    | "retry"
    | "open_settings"
    | "turn_on_location"
    | "open_ticket"
    | "sign_in"
    | "none";
  /** For `open_ticket` (already in this queue). */
  tokenId?: string;
  /** Error code and request id line for support. */
  support?: string;
};

const ASK_STAFF = "If you are at the counter, ask the staff to add you.";

function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : {};
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function locationProblemView(p: LocationProblem): JoinProblem {
  switch (p.kind) {
    case "denied":
      return {
        title: "Location permission needed",
        message: `Qpeer checks once that you are at the business before you join as a walk-in. Your location is not stored. ${
          p.canAskAgain
            ? "Tap Try again and choose Allow."
            : "Turn on location permission for Qpeer in Settings."
        } ${ASK_STAFF}`,
        fix: p.canAskAgain ? "retry" : "open_settings",
      };
    case "services_off":
      return {
        title: "Your phone's location is off",
        message:
          "Turn on location so Qpeer can check you are at the business. You can turn it off again after joining.",
        fix: "turn_on_location",
      };
    default:
      return {
        title: "Could not find your location",
        message: `Move near a window or outside, then try again. ${ASK_STAFF}`,
        fix: "retry",
      };
  }
}

/**
 * The GPS checks share the join's rules and texts (JON-05/06): joining,
 * checking in a Priority Pass (PRI-03) and "I'm here" after a miss (QUE-23).
 */
export type LocationAction = "join" | "checkin" | "rejoin";

const ACTION_TEXT: Record<
  LocationAction,
  { failed: string; verb: string; staff: string }
> = {
  join: { failed: "Could not join", verb: "join", staff: ASK_STAFF },
  checkin: {
    failed: "Could not check in",
    verb: "check in",
    staff: "If you are at the counter, show the staff your pass.",
  },
  rejoin: {
    failed: "Could not rejoin",
    verb: "rejoin",
    staff:
      "If you are at the counter, tell the staff your number and check code.",
  },
};

function supportLine(error: ApiError): string {
  return `Code: ${error.code}${error.requestId ? ` · Request ID: ${error.requestId}` : ""}`;
}

export function joinErrorView(
  error: unknown,
  action: LocationAction = "join",
): JoinProblem {
  const text = ACTION_TEXT[action];
  if (!(error instanceof ApiError)) {
    return {
      title: text.failed,
      message: errorText(error),
      fix: "retry",
    };
  }
  const support = supportLine(error);
  const d = obj(error.details);
  switch (error.code) {
    case "too_far": {
      const distance = num(d.distanceM);
      const radius = num(d.joinRadiusM);
      const where =
        distance !== null
          ? `You seem to be about ${formatDistance(distance)} away`
          : "You seem to be far from this business";
      const need =
        radius !== null
          ? ` and need to be within ${radius} m to ${text.verb}`
          : "";
      return {
        title: "You are too far away",
        message: `${where}${need}. Move closer and try again. ${text.staff}`,
        fix: "retry",
        support,
      };
    }
    case "mock_location":
      return {
        title: "Fake location detected",
        message:
          "Turn off any mock-location app in Developer options, then try again.",
        fix: "retry",
        support,
      };
    case "no_location_fix":
      return {
        title: "Your location is not accurate enough",
        message: `Your phone could only place you within about a kilometre. Turn on high-accuracy location or move outside, then try again. ${text.staff}`,
        fix: "retry",
        support,
      };
    case "queue_closed":
      return {
        title: "This queue is closed",
        message: "It is not taking anyone right now. Try again when it opens.",
        fix: "retry",
        support,
      };
    case "queue_paused":
      return {
        title: "This queue is paused",
        message: "The staff paused joining for a moment. Try again shortly.",
        fix: "retry",
        support,
      };
    case "queue_full":
      return {
        title: "This queue is full",
        message: "It has reached its limit for now. Try again later.",
        fix: "retry",
        support,
      };
    case "free_lane_blocked": {
      const until = num(d.until);
      return {
        title: "Walk-in joins are paused for you",
        message: `You missed your turn 3 times in the last 30 days, so free joins are paused${
          until !== null ? ` until ${formatDateTime(until)}` : " for a while"
        }. ${ASK_STAFF}`,
        fix: "none",
        support,
      };
    }
    case "already_in_queue": {
      const tokenId = typeof d.tokenId === "string" ? d.tokenId : undefined;
      return {
        title: "You are already in this queue",
        message: "Open your ticket to see your place.",
        fix: tokenId ? "open_ticket" : "none",
        tokenId,
        support,
      };
    }
    case "device_in_queue":
      // C2 (INC-042): e.g. the app was reinstalled or the data cleared.
      return {
        title: "This phone already has a ticket here",
        message:
          "A ticket for this queue was taken on this phone, maybe before the app was reinstalled. One free walk-in ticket per phone keeps the queue fair. If you need a second place, ask the staff at the counter.",
        fix: "none",
        support,
      };
    case "not_found":
      return action === "join"
        ? {
            title: "Queue not found",
            message:
              "This queue does not exist or is not open to the public right now.",
            fix: "none",
            support,
          }
        : {
            title: "Ticket not found",
            message: "This ticket no longer exists. Pull down to refresh.",
            fix: "none",
            support,
          };
    case "invalid_state":
      if (action === "checkin") {
        return {
          title: "This pass can't be checked in",
          message:
            "Its time to check in has ended, or it was already checked in. Pull down to see its latest state.",
          fix: "none",
          support,
        };
      }
      if (action === "rejoin") {
        return {
          title: "You can't rejoin with this ticket",
          message:
            "A ticket can rejoin only once, after it was missed. Pull down to see its latest state.",
          fix: "none",
          support,
        };
      }
      return {
        title: text.failed,
        message: errorText(error),
        fix: "retry",
        support,
      };
    default:
      return {
        title: text.failed,
        message: errorText(error),
        fix: "retry",
        support,
      };
  }
}

/**
 * Why an order (reservation, Priority Pass, Skip ahead) can't be made, and
 * what the button offers (PAY-01, PRI-02, PRI-05, PRI-11).
 */
export function payErrorView(error: unknown): JoinProblem {
  if (!(error instanceof ApiError)) {
    return {
      title: "Could not start the payment",
      message: errorText(error),
      fix: "retry",
    };
  }
  const support = supportLine(error);
  const d = obj(error.details);
  switch (error.code) {
    case "registration_required":
      return {
        title: "Sign in to pay",
        message:
          "Paid places are tied to your account, so sign in with your phone or Google first.",
        fix: "sign_in",
        support,
      };
    case "priority_off":
      return {
        title: "No priority lane here",
        message:
          "The business has switched the priority lane off. You can still join the regular queue.",
        fix: "none",
        support,
      };
    case "sold_out":
      return {
        title: "Sold out for today",
        message:
          "All of today's Priority Passes for this queue are sold. You can still join the regular queue.",
        fix: "none",
        support,
      };
    case "pass_limit":
      return {
        title: "One pass per day",
        message: errorText(error),
        fix: "none",
        support,
      };
    case "quota_full":
      return {
        title: "No reservations left right now",
        message:
          "The places kept for reservations are taken, or you already hold the most paid tickets allowed here. Try again later or walk in.",
        fix: "retry",
        support,
      };
    case "invalid_state": {
      const reason = typeof d.reason === "string" ? d.reason : null;
      return {
        title:
          reason === "saving_below_threshold"
            ? "Skipping ahead wouldn't save time now"
            : "Not possible right now",
        message:
          reason === "saving_below_threshold"
            ? "The priority lane is about as fast as your place right now, so there is nothing to buy. Your place is kept."
            : errorText(error),
        fix: "none",
        support,
      };
    }
    case "already_in_queue": {
      const tokenId = typeof d.tokenId === "string" ? d.tokenId : undefined;
      return {
        title: "You already have a ticket here",
        message: tokenId
          ? "One ticket per person per queue. Open it: a waiting ticket can skip ahead from there."
          : "One ticket per person per queue.",
        fix: tokenId ? "open_ticket" : "none",
        tokenId,
        support,
      };
    }
    case "queue_closed":
    case "queue_paused":
    case "queue_full":
      return {
        title: "Can't reserve right now",
        message: errorText(error),
        fix: "retry",
        support,
      };
    default:
      return {
        title: "Could not start the payment",
        message: errorText(error),
        fix: "retry",
        support,
      };
  }
}
