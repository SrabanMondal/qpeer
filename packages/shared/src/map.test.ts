import { describe, expect, it } from "vitest";
import { MAP_DEFAULT_LIMIT, MapQuery } from "./map";

const box = {
  minLat: "32.70",
  minLng: "74.80",
  maxLat: "32.76",
  maxLng: "74.90",
};

describe("MapQuery (MAP-01)", () => {
  it("parses string values with defaults", () => {
    expect(MapQuery.parse(box)).toEqual({
      minLat: 32.7,
      minLng: 74.8,
      maxLat: 32.76,
      maxLng: 74.9,
      openNow: false,
      limit: MAP_DEFAULT_LIMIT,
    });
    expect(
      MapQuery.parse({ ...box, openNow: "1", category: "lab", limit: "5" }),
    ).toMatchObject({ openNow: true, category: "lab", limit: 5 });
  });

  it.each([
    [{ ...box, maxLat: "34.30" }, "maxLat"], // 1.6° tall
    [{ ...box, maxLng: "76.40" }, "maxLng"], // 1.6° wide
    [{ ...box, minLat: "32.80" }, "maxLat"], // min > max
    [{ ...box, minLat: "91" }, "minLat"],
    [{ ...box, minLng: "abc" }, "minLng"],
    [{ ...box, limit: "301" }, "limit"],
    [{ ...box, category: "bakery" }, "category"],
    [{ ...box, extra: "1" }, ""],
  ])("rejects %o", (q, path) => {
    const r = MapQuery.safeParse(q);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join("."))).toContain(path);
    }
  });

  it("requires all four box edges", () => {
    const { maxLng: _m, ...noMaxLng } = box;
    expect(MapQuery.safeParse(noMaxLng).success).toBe(false);
  });
});
