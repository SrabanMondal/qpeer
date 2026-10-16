import { describe, expect, it } from "vitest";
import {
  CLOCK_BLOCKING_MS,
  CLOCK_MAX_RTT_MS,
  CLOCK_OK_MS,
  classifySkew,
  estimateClockOffset,
  HealthResponse,
  pickOffset,
} from "./clock";

const MIN = 60_000;
const T = 1_760_000_000_000;

describe("estimateClockOffset", () => {
  it("zero skew gives offset 0", () => {
    const r = estimateClockOffset({
      sentAt: T,
      receivedAt: T + 200,
      serverTime: T + 100,
    });
    expect(r).toEqual({ offsetMs: 0, rttMs: 200 });
    expect(classifySkew(r.offsetMs)).toBe("ok");
  });

  it("phone fast by 11.5 min is blocking with a negative offset", () => {
    const phone = T + 11.5 * MIN;
    const r = estimateClockOffset({
      sentAt: phone,
      receivedAt: phone + 300,
      serverTime: T + 150,
    });
    expect(r.offsetMs).toBe(-11.5 * MIN);
    expect(r.rttMs).toBe(300);
    expect(classifySkew(r.offsetMs)).toBe("blocking");
  });

  it("phone slow gives a positive offset", () => {
    const phone = T - 5 * MIN;
    const r = estimateClockOffset({
      sentAt: phone,
      receivedAt: phone + 100,
      serverTime: T + 50,
    });
    expect(r.offsetMs).toBe(5 * MIN);
    expect(classifySkew(r.offsetMs)).toBe("blocking");
  });

  it("phone slow by a minute is minor", () => {
    expect(classifySkew(MIN)).toBe("minor");
    expect(classifySkew(-MIN)).toBe("minor");
  });
});

describe("pickOffset", () => {
  it("picks the smallest round trip", () => {
    expect(
      pickOffset([
        { offsetMs: 10, rttMs: 900 },
        { offsetMs: 20, rttMs: 150 },
        { offsetMs: 30, rttMs: 400 },
      ]),
    ).toEqual({ offsetMs: 20, rttMs: 150 });
  });

  it("ignores samples with a round trip over 10 s", () => {
    expect(
      pickOffset([
        { offsetMs: 99, rttMs: CLOCK_MAX_RTT_MS + 1 },
        { offsetMs: 5, rttMs: 3000 },
      ]),
    ).toEqual({ offsetMs: 5, rttMs: 3000 });
    expect(pickOffset([{ offsetMs: 99, rttMs: 20_000 }])).toBeNull();
  });

  it("returns null for no samples", () => {
    expect(pickOffset([])).toBeNull();
  });
});

describe("classifySkew boundaries", () => {
  it("exactly 30 s is ok, just over is minor", () => {
    expect(CLOCK_OK_MS).toBe(30_000);
    expect(classifySkew(CLOCK_OK_MS)).toBe("ok");
    expect(classifySkew(-CLOCK_OK_MS)).toBe("ok");
    expect(classifySkew(CLOCK_OK_MS + 1)).toBe("minor");
  });

  it("exactly 2 min is minor, just over is blocking", () => {
    expect(CLOCK_BLOCKING_MS).toBe(2 * MIN);
    expect(classifySkew(CLOCK_BLOCKING_MS)).toBe("minor");
    expect(classifySkew(-CLOCK_BLOCKING_MS)).toBe("minor");
    expect(classifySkew(CLOCK_BLOCKING_MS + 1)).toBe("blocking");
    expect(classifySkew(-CLOCK_BLOCKING_MS - 1)).toBe("blocking");
  });
});

describe("HealthResponse", () => {
  it("needs serverTime", () => {
    expect(HealthResponse.safeParse({ ok: true, env: "dev" }).success).toBe(
      false,
    );
    expect(
      HealthResponse.safeParse({ ok: true, env: "dev", serverTime: T }).success,
    ).toBe(true);
  });
});
