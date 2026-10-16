import type { MarkerStatus } from "@qpeer/shared";

import { Badge, type BadgeTone } from "@/components/ui";

/** Badge text for a business on the map/list: its queues first, then its hours. */
export function statusLook(
  status: MarkerStatus,
  isOpenNow: boolean,
): { label: string; tone: BadgeTone } {
  if (status === "open") return { label: "Open now", tone: "success" };
  if (status === "paused") return { label: "Paused", tone: "warning" };
  return isOpenNow
    ? { label: "Queue not open", tone: "neutral" }
    : { label: "Closed now", tone: "neutral" };
}

export function StatusPill({
  status,
  isOpenNow,
}: {
  status: MarkerStatus;
  isOpenNow: boolean;
}) {
  const look = statusLook(status, isOpenNow);
  return <Badge label={look.label} tone={look.tone} />;
}
