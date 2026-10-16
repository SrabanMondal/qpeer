import type {
  BusinessCategory,
  BusinessView,
  DayHours,
  ListingRequirement,
  Weekday,
  WeeklyHours,
} from "@qpeer/shared";

import type { BadgeTone } from "@/components/ui/badge";
import type { Choice } from "@/components/ui/choice-chips";
import type { StatusTone } from "@/components/ui/status-banner";
import { serverNow } from "@/lib/clock";

export const CATEGORY_CHOICES: readonly Choice<BusinessCategory>[] = [
  { value: "clinic", label: "Clinic" },
  { value: "lab", label: "Lab" },
  { value: "service_centre", label: "Service centre" },
  { value: "salon", label: "Salon" },
  { value: "other", label: "Other" },
];

export function categoryLabel(category: BusinessCategory): string {
  return CATEGORY_CHOICES.find((c) => c.value === category)?.label ?? category;
}

const MISSING_TEXT: Record<ListingRequirement, string> = {
  pin: "add a pin",
  queue: "add a queue",
};

/** "add a pin / add a queue" for whatever is still missing (BIZ-07). */
export function missingText(missing: readonly ListingRequirement[]): string {
  return missing.map((m) => MISSING_TEXT[m]).join(" / ");
}

/** Status badge for a business: Listed, Not listed: …, or Inactive (BIZ-07, BIZ-08). */
export function listingBadge(b: BusinessView): {
  label: string;
  tone: BadgeTone;
} {
  if (b.status === "inactive") return { label: "Inactive", tone: "neutral" };
  if (b.listed) return { label: "Listed", tone: "success" };
  const missing = b.missingForListing ?? [];
  return {
    label:
      missing.length > 0 ? `Not listed: ${missingText(missing)}` : "Not listed",
    tone: "warning",
  };
}

/** The StatusBanner content for a business's listing state (BIZ-07, BIZ-08). */
export function listingStatus(b: BusinessView): {
  tone: StatusTone;
  title: string;
  detail: string;
} {
  if (b.status === "inactive") {
    return {
      tone: "closed",
      title: "Inactive",
      detail: "Hidden from the map. Activate it to list it again.",
    };
  }
  if (b.listed) {
    return {
      tone: "active",
      title: "Listed on the map",
      detail: "Customers can find it and see its queues.",
    };
  }
  const missing = b.missingForListing ?? [];
  return {
    tone: "paused",
    title: "Not listed yet",
    detail:
      missing.length > 0
        ? `To show on the map: ${missingText(missing)}.`
        : "It will show on the map soon.",
  };
}

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const BY_JS_DAY: readonly Weekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's weekday in India (business hours are Asia/Kolkata in v1). */
export function todayInIndia(now = serverNow()): Weekday {
  return BY_JS_DAY[new Date(now + IST_OFFSET_MS).getUTCDay()];
}

/** "17:30" → "5:30 PM" (UI shows 12-hour times, design guide §6). Bad input is returned as is. */
export function formatTime12(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** "9:00 AM – 1:00 PM, 3:00 PM – 6:00 PM" or "Closed". */
export function formatDay(ranges: DayHours): string {
  if (ranges.length === 0) return "Closed";
  return ranges
    .map((r) => `${formatTime12(r.from)} – ${formatTime12(r.to)}`)
    .join(", ");
}

/** "Open today 09:00–18:00" or "Closed today" (BIZ-05). */
export function todayText(hours: WeeklyHours, now = serverNow()): string {
  const ranges = hours[todayInIndia(now)];
  return ranges.length === 0
    ? "Closed today"
    : `Open today ${formatDay(ranges)}`;
}

/** 2000 paise → "20" ; 2050 → "20.50" (for editing in ₹). */
export function paiseToRupeesText(paise: number): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

/** "₹20" / "₹20.50" */
export function formatRupees(paise: number): string {
  return `₹${paiseToRupeesText(paise)}`;
}

/** "32.72660, 74.85700" */
export function formatLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
