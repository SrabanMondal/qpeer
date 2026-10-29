import { z } from "zod";

const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Longest ticket validity: 7 days. */
export const TICKET_VALIDITY_MAX_MIN = 7 * 24 * 60;

/** Validity choices shown to owners (minutes; 0 = until the queue closes). */
export const TICKET_VALIDITY_PRESETS_MIN = [
  0, 60, 120, 240, 480, 1440, 2880, 10080,
] as const;

/** "Until the queue closes", "1 h", "8 h", "1 day", "7 days". */
export function ticketValidityLabel(minutes: number): string {
  if (minutes <= 0) return "Until the queue closes";
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? "1 day" : `${d} days`;
  }
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

/** Priority Pass validity choices (minutes; 0 = until the end of today, IST). */
export const PRIORITY_VALIDITY_PRESETS_MIN = [
  0, 120, 240, 480, 1440, 2880, 10080,
] as const;

/** The ratio the app's form prefills when the owner switches priority on. */
export const PRIORITY_PER_REGULAR_PREFILL = 2;

/** Field rules for queue settings (bounds only, no defaults). */
const settingsFields = {
  /** Walk-in join radius around the pin, metres. */
  joinRadiusM: int(50, 2000),
  /** Share of the queue reserved for walk-ins, percent. */
  walkinQuotaPct: int(0, 100),
  /** Remote reservation fee (paise). Razorpay needs at least 100 to sell one. */
  reservationFeePaise: int(0, 100_000),
  // ----- Priority Pass + upgrade (decided 2026-10-18, PRI-01; all business-set) -----
  /** Priority lane on/off. Off by default. */
  priorityEnabled: z.boolean(),
  /** Price of a pass and of an upgrade ("Skip ahead"), paise. */
  priorityFeePaise: int(0, 100_000),
  /**
   * N in "1 priority per N regulars" (credit counter, PRI-06). Any whole
   * number ≥ 1; the form prefills 2 when priority is switched on.
   */
  priorityPerRegular: int(1, 100),
  /** Optional daily sales cap (passes + upgrades, IST day); null = no cap. */
  priorityDailyCap: int(1, 10_000).nullable(),
  /** Pass validity window in minutes; 0 = until the end of today (IST). */
  priorityValidityMin: int(0, TICKET_VALIDITY_MAX_MIN),
  /** Refund share when a customer cancels a pass before check-in, percent. */
  priorityCancelRefundPct: int(0, 100),
  /** The upgrade offer is hidden below this estimated saving (C2), minutes. */
  upgradeMinSavingMin: int(0, 240),
  /**
   * Not used for the split: the demo split is the platform constant
   * `DEMO_BUSINESS_SHARE_PCT` (payments.ts). Kept for stored settings.
   */
  businessSharePct: int(0, 100),
  graceMinutes: int(1, 60),
  // ----- Missed turn (R1, decided 2026-10-18) -----
  /**
   * Rejoin delay in minutes of service: "I'm here" (and staff Skip) puts the
   * ticket behind max(1, ceil(rejoinDelayMin ÷ avgServiceMin)) waiting people.
   */
  rejoinDelayMin: int(0, 240),
  /**
   * Late window after MISSED, minutes: "I'm here" within it → the rejoin-delay
   * rule; after it → the end of the line. null = no limit.
   */
  lateWindowMin: int(1, 1440).nullable(),
  /** Remote reservations: cancelling at least this long before the estimated call is refunded. */
  cancelWindowMin: int(0, 240),
  counters: int(1, 20),
  maxSize: int(10, 2000),
  serviceMinutesHint: int(1, 120),
  triageDailyCap: int(0, 50),
  /**
   * Retired (INC-065): one active ticket per person per queue applies to paid
   * reservations too. Still accepted and stored so older settings and apps
   * keep validating; the server never reads it.
   */
  paidPerUserCap: int(0, 10),
  /**
   * Ticket validity (C4), minutes from joining; 0 = until the queue closes
   * (the default). A ticket still valid when the queue closes carries over
   * to the front of the next session.
   */
  ticketValidityMin: int(0, TICKET_VALIDITY_MAX_MIN),
};

/** Defaults from the backend architecture doc, section 8. */
export const QUEUE_SETTINGS_DEFAULTS = {
  joinRadiusM: 150,
  walkinQuotaPct: 50,
  reservationFeePaise: 2000,
  priorityEnabled: false,
  priorityFeePaise: 10000,
  priorityPerRegular: PRIORITY_PER_REGULAR_PREFILL,
  priorityDailyCap: null,
  priorityValidityMin: 0,
  priorityCancelRefundPct: 50,
  upgradeMinSavingMin: 5,
  businessSharePct: 70,
  graceMinutes: 10,
  rejoinDelayMin: 15,
  lateWindowMin: 15,
  cancelWindowMin: 15,
  counters: 1,
  maxSize: 300,
  serviceMinutesHint: 5,
  triageDailyCap: 5,
  paidPerUserCap: 2,
  ticketValidityMin: 0,
} as const satisfies {
  [K in keyof typeof settingsFields]: z.input<(typeof settingsFields)[K]>;
};

/**
 * Settings stored before Step 4 used `priorityPerRegular: 0` for "off"; the
 * on/off switch is now `priorityEnabled`, so 0 reads as the prefill.
 */
const legacyPerRegular = (v: unknown) =>
  v === 0 ? PRIORITY_PER_REGULAR_PREFILL : v;

const d = QUEUE_SETTINGS_DEFAULTS;

/** Full settings; missing fields take their defaults (`QueueSettings.parse({})`). */
export const QueueSettings = z.object({
  joinRadiusM: settingsFields.joinRadiusM.default(d.joinRadiusM),
  walkinQuotaPct: settingsFields.walkinQuotaPct.default(d.walkinQuotaPct),
  reservationFeePaise: settingsFields.reservationFeePaise.default(
    d.reservationFeePaise,
  ),
  priorityEnabled: settingsFields.priorityEnabled.default(d.priorityEnabled),
  priorityFeePaise: settingsFields.priorityFeePaise.default(d.priorityFeePaise),
  priorityPerRegular: z
    .preprocess(legacyPerRegular, settingsFields.priorityPerRegular)
    .default(d.priorityPerRegular),
  priorityDailyCap: settingsFields.priorityDailyCap.default(d.priorityDailyCap),
  priorityValidityMin: settingsFields.priorityValidityMin.default(
    d.priorityValidityMin,
  ),
  priorityCancelRefundPct: settingsFields.priorityCancelRefundPct.default(
    d.priorityCancelRefundPct,
  ),
  upgradeMinSavingMin: settingsFields.upgradeMinSavingMin.default(
    d.upgradeMinSavingMin,
  ),
  businessSharePct: settingsFields.businessSharePct.default(d.businessSharePct),
  graceMinutes: settingsFields.graceMinutes.default(d.graceMinutes),
  rejoinDelayMin: settingsFields.rejoinDelayMin.default(d.rejoinDelayMin),
  lateWindowMin: settingsFields.lateWindowMin.default(d.lateWindowMin),
  cancelWindowMin: settingsFields.cancelWindowMin.default(d.cancelWindowMin),
  counters: settingsFields.counters.default(d.counters),
  maxSize: settingsFields.maxSize.default(d.maxSize),
  serviceMinutesHint: settingsFields.serviceMinutesHint.default(
    d.serviceMinutesHint,
  ),
  triageDailyCap: settingsFields.triageDailyCap.default(d.triageDailyCap),
  paidPerUserCap: settingsFields.paidPerUserCap.default(d.paidPerUserCap),
  ticketValidityMin: settingsFields.ticketValidityMin.default(
    d.ticketValidityMin,
  ),
});

export type QueueSettings = z.infer<typeof QueueSettings>;

/** Partial settings for create/update requests. Unknown keys are rejected. */
export const QueueSettingsPatch = z.object(settingsFields).partial().strict();

export type QueueSettingsPatch = z.infer<typeof QueueSettingsPatch>;

export function defaultQueueSettings(): QueueSettings {
  return QueueSettings.parse({});
}

/**
 * Public Priority Pass fields of a queue (PRI-07: "Priority lane on · 1 in N"
 * on the business page, join screen and ticket). Everything else in the
 * settings stays members-only.
 */
export const QueuePriorityInfo = z.object({
  enabled: z.boolean(),
  /** N in "1 priority per N regulars". */
  perRegular: z.number().int(),
  /** Price of a pass / an upgrade, paise. */
  feePaise: z.number().int(),
});
export type QueuePriorityInfo = z.infer<typeof QueuePriorityInfo>;

export function priorityInfo(s: QueueSettings): QueuePriorityInfo {
  return {
    enabled: s.priorityEnabled,
    perRegular: s.priorityPerRegular,
    feePaise: s.priorityFeePaise,
  };
}

/** "Priority lane on · 1 in 2" (null when the lane is off). */
export function priorityLaneLabel(p: QueuePriorityInfo): string | null {
  return p.enabled ? `Priority lane on · 1 in ${p.perRegular}` : null;
}
