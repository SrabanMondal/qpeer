import { describe, expect, it } from "vitest";
import { distanceMeters } from "./geo";

describe("distanceMeters", () => {
  it("returns 0 for identical points", () => {
    const jammu = { lat: 32.7266, lng: 74.857 };
    expect(distanceMeters(jammu, jammu)).toBe(0);
  });

  it("is symmetric", () => {
    const a = { lat: 32.731, lng: 74.863 };
    const b = { lat: 32.739, lng: 74.868 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });

  it("calculates known distance between two points in Jammu ~1 km apart within 1m", () => {
    // Points in Jammu:
    // a: (32.7310° N, 74.8630° E)
    // b: (32.7390° N, 74.8680° E)
    // Precomputed haversine distance with Earth radius 6371008.8m is ~1005.01m
    const a = { lat: 32.731, lng: 74.863 };
    const b = { lat: 32.739, lng: 74.868 };
    const precomputedMeters = 1005.01;
    const distance = distanceMeters(a, b);
    expect(Math.abs(distance - precomputedMeters)).toBeLessThan(1.0);
  });

  it("calculates antipodal sanity (half Earth circumference)", () => {
    const northPole = { lat: 90, lng: 0 };
    const southPole = { lat: -90, lng: 0 };
    const expectedHalfCircumference = Math.PI * 6371008.8; // ~20,015,114.35 m
    expect(distanceMeters(northPole, southPole)).toBeCloseTo(
      expectedHalfCircumference,
      1,
    );

    const equatorZero = { lat: 0, lng: 0 };
    const equatorOpposite = { lat: 0, lng: 180 };
    expect(distanceMeters(equatorZero, equatorOpposite)).toBeCloseTo(
      expectedHalfCircumference,
      1,
    );
  });
});
