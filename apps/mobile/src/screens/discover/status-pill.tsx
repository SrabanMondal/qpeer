import { type MarkerStatus, openLook } from "@qpeer/shared";

import { Badge, type BadgeTone } from "@/components/ui";

/**
 * Badge text for a business or queue (B16, INC-043): the queue state decides
 * (open / paused / closed); the hours only add "(after usual hours)" or tell
 * "Queue not open" from "Closed now". Same words on the map card, list row,
 * business page and join screen (`openLook` in shared).
 */
export function statusLook(
  status: MarkerStatus,
  withinHours: boolean | undefined,
): { label: string; tone: BadgeTone } {
  const look = openLook(status, withinHours);
  return { label: look.label, tone: look.tone };
}

export function StatusPill({
  status,
  isOpenNow,
}: {
  status: MarkerStatus;
  /** Inside today's hours (IST); undefined when not known. */
  isOpenNow: boolean | undefined;
}) {
  const look = statusLook(status, isOpenNow);
  return <Badge label={look.label} tone={look.tone} />;
}
