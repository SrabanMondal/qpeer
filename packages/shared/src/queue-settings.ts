import { z } from "zod";

const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Field rules for queue settings (bounds only, no defaults). */
const settingsFields = {
  /** Walk-in join radius around the pin, metres. */
  joinRadiusM: int(50, 2000),
  /** Share of the queue reserved for walk-ins, percent. */
  walkinQuotaPct: int(0, 100),
  reservationFeePaise: int(0, 100_000),
  priorityFeePaise: int(0, 100_000),
  /** One priority entry per N regular tokens; 0 = no limit (off). */
  priorityPerRegular: int(0, 20),
  businessSharePct: int(0, 100),
  graceMinutes: int(1, 60),
  cancelWindowMin: int(0, 240),
  counters: int(1, 20),
  maxSize: int(10, 2000),
  serviceMinutesHint: int(1, 120),
  triageDailyCap: int(0, 50),
  paidPerUserCap: int(0, 10),
};

/** Defaults from the backend architecture doc, section 8. */
export const QUEUE_SETTINGS_DEFAULTS = {
  joinRadiusM: 150,
  walkinQuotaPct: 50,
  reservationFeePaise: 2000,
  priorityFeePaise: 10000,
  priorityPerRegular: 0,
  businessSharePct: 70,
  graceMinutes: 10,
  cancelWindowMin: 15,
  counters: 1,
  maxSize: 300,
  serviceMinutesHint: 5,
  triageDailyCap: 5,
  paidPerUserCap: 2,
} as const satisfies { [K in keyof typeof settingsFields]: number };

/** Full settings; missing fields take their defaults (`QueueSettings.parse({})`). */
export const QueueSettings = z.object({
  joinRadiusM: settingsFields.joinRadiusM.default(
    QUEUE_SETTINGS_DEFAULTS.joinRadiusM,
  ),
  walkinQuotaPct: settingsFields.walkinQuotaPct.default(
    QUEUE_SETTINGS_DEFAULTS.walkinQuotaPct,
  ),
  reservationFeePaise: settingsFields.reservationFeePaise.default(
    QUEUE_SETTINGS_DEFAULTS.reservationFeePaise,
  ),
  priorityFeePaise: settingsFields.priorityFeePaise.default(
    QUEUE_SETTINGS_DEFAULTS.priorityFeePaise,
  ),
  priorityPerRegular: settingsFields.priorityPerRegular.default(
    QUEUE_SETTINGS_DEFAULTS.priorityPerRegular,
  ),
  businessSharePct: settingsFields.businessSharePct.default(
    QUEUE_SETTINGS_DEFAULTS.businessSharePct,
  ),
  graceMinutes: settingsFields.graceMinutes.default(
    QUEUE_SETTINGS_DEFAULTS.graceMinutes,
  ),
  cancelWindowMin: settingsFields.cancelWindowMin.default(
    QUEUE_SETTINGS_DEFAULTS.cancelWindowMin,
  ),
  counters: settingsFields.counters.default(QUEUE_SETTINGS_DEFAULTS.counters),
  maxSize: settingsFields.maxSize.default(QUEUE_SETTINGS_DEFAULTS.maxSize),
  serviceMinutesHint: settingsFields.serviceMinutesHint.default(
    QUEUE_SETTINGS_DEFAULTS.serviceMinutesHint,
  ),
  triageDailyCap: settingsFields.triageDailyCap.default(
    QUEUE_SETTINGS_DEFAULTS.triageDailyCap,
  ),
  paidPerUserCap: settingsFields.paidPerUserCap.default(
    QUEUE_SETTINGS_DEFAULTS.paidPerUserCap,
  ),
});

export type QueueSettings = z.infer<typeof QueueSettings>;

/** Partial settings for create/update requests. Unknown keys are rejected. */
export const QueueSettingsPatch = z.object(settingsFields).partial().strict();

export type QueueSettingsPatch = z.infer<typeof QueueSettingsPatch>;

export function defaultQueueSettings(): QueueSettings {
  return QueueSettings.parse({});
}
