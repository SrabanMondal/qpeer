/**
 * Queue QR codes encode `qpeer://q/<queue uuid>` (JON-01, JON-02). The same
 * `/q/<uuid>` path inside an https link is accepted too, for a future web
 * link. Anything else is not a Qpeer queue code.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const APP_LINK = /^qpeer:\/\/q\/([^/?#]+)\/?(?:[?#].*)?$/i;
const WEB_LINK = /^https:\/\/[^/?#]+\/q\/([^/?#]+)\/?(?:[?#].*)?$/i;

/** The queue id in a scanned code, or null. */
export function parseJoinCode(raw: string): string | null {
  const text = raw.trim();
  const m = APP_LINK.exec(text) ?? WEB_LINK.exec(text);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return isQueueId(id) ? id.toLowerCase() : null;
}

/** Queue ids are UUIDs (v4 from the API). */
export function isQueueId(id: string | undefined): id is string {
  return typeof id === "string" && UUID.test(id);
}
