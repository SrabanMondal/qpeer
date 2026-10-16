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

describe("QueueSettingsPatch", () => {
  it("is partial and adds no defaults", () => {
    expect(QueueSettingsPatch.parse({})).toEqual({});
    expect(QueueSettingsPatch.parse({ counters: 3 })).toEqual({ counters: 3 });
  });

  it("rejects unknown keys", () => {
    expect(QueueSettingsPatch.safeParse({ radius: 100 }).success).toBe(false);
  });
});
