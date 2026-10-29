import { describe, expect, it } from "vitest";
import {
  defaultQueueSettings,
  QUEUE_SETTINGS_DEFAULTS,
  QueueSettings,
  QueueSettingsPatch,
  TICKET_VALIDITY_PRESETS_MIN,
  ticketValidityLabel,
} from "./queue-settings";

describe("QueueSettings", () => {
  it("BIZ-12: defaults match the architecture doc", () => {
    expect(defaultQueueSettings()).toEqual({
      joinRadiusM: 150,
      walkinQuotaPct: 50,
      reservationFeePaise: 2000,
      priorityEnabled: false,
      priorityFeePaise: 10000,
      priorityPerRegular: 2,
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
    });
    expect(defaultQueueSettings()).toEqual(QUEUE_SETTINGS_DEFAULTS);
  });

  it("C4: ticket validity is 0 (until close) to 7 days; every preset is allowed", () => {
    expect(QueueSettings.safeParse({ ticketValidityMin: 10_081 }).success).toBe(
      false,
    );
    expect(QueueSettings.safeParse({ ticketValidityMin: -1 }).success).toBe(
      false,
    );
    for (const m of TICKET_VALIDITY_PRESETS_MIN) {
      expect(
        QueueSettingsPatch.safeParse({ ticketValidityMin: m }).success,
      ).toBe(true);
    }
    expect(ticketValidityLabel(0)).toBe("Until the queue closes");
    expect(ticketValidityLabel(60)).toBe("1 h");
    expect(ticketValidityLabel(1440)).toBe("1 day");
    expect(ticketValidityLabel(10080)).toBe("7 days");
    expect(ticketValidityLabel(90)).toBe("90 min");
  });

  it("fills missing fields with defaults", () => {
    const s = QueueSettings.parse({ joinRadiusM: 300 });
    expect(s.joinRadiusM).toBe(300);
    expect(s.graceMinutes).toBe(10);
  });

  it.each([
    ["joinRadiusM", 49],
    ["joinRadiusM", 2001],
    ["walkinQuotaPct", -1],
    ["walkinQuotaPct", 101],
    ["reservationFeePaise", 100_001],
    ["priorityFeePaise", -1],
    ["graceMinutes", 0],
    ["graceMinutes", 61],
    ["counters", 0],
    ["counters", 21],
    ["maxSize", 9],
    ["maxSize", 2001],
    ["joinRadiusM", 150.5],
  ])("BIZ-12: rejects %s = %s", (field, value) => {
    expect(QueueSettings.safeParse({ [field]: value }).success).toBe(false);
    expect(QueueSettingsPatch.safeParse({ [field]: value }).success).toBe(
      false,
    );
  });

  it.each([
    ["joinRadiusM", 50],
    ["joinRadiusM", 2000],
    ["walkinQuotaPct", 0],
    ["walkinQuotaPct", 100],
    ["reservationFeePaise", 0],
    ["reservationFeePaise", 100_000],
    ["graceMinutes", 1],
    ["graceMinutes", 60],
    ["counters", 20],
    ["maxSize", 10],
    ["maxSize", 2000],
  ])("accepts boundary %s = %s", (field, value) => {
    expect(QueueSettings.safeParse({ [field]: value }).success).toBe(true);
  });
});

describe("PRI-01 / R1 settings", () => {
  it("PRI-01: priority is off by default; N ≥ 1 (1-in-1 allowed); legacy 0 reads as the prefill 2", () => {
    const s = defaultQueueSettings();
    expect(s.priorityEnabled).toBe(false);
    expect(
      QueueSettings.parse({ priorityPerRegular: 1 }).priorityPerRegular,
    ).toBe(1);
    expect(
      QueueSettings.parse({ priorityPerRegular: 0 }).priorityPerRegular,
    ).toBe(2);
    expect(
      QueueSettingsPatch.safeParse({ priorityPerRegular: 0 }).success,
    ).toBe(false);
    expect(
      QueueSettingsPatch.safeParse({ priorityDailyCap: null }).success,
    ).toBe(true);
    expect(
      QueueSettingsPatch.safeParse({ priorityCancelRefundPct: 101 }).success,
    ).toBe(false);
  });

  it("R1: late window may be null (no limit); rejoin delay 0 is allowed", () => {
    expect(
      QueueSettings.parse({ lateWindowMin: null }).lateWindowMin,
    ).toBeNull();
    expect(QueueSettings.parse({ rejoinDelayMin: 0 }).rejoinDelayMin).toBe(0);
    expect(QueueSettingsPatch.safeParse({ lateWindowMin: 0 }).success).toBe(
      false,
    );
  });
});

describe("QueueSettingsPatch", () => {
  it("is partial and adds no defaults", () => {
    expect(QueueSettingsPatch.parse({})).toEqual({});
    expect(QueueSettingsPatch.parse({ counters: 3 })).toEqual({ counters: 3 });
  });

  it("rejects unknown keys", () => {
    expect(QueueSettingsPatch.safeParse({ radius: 100 }).success).toBe(false);
  });
});
