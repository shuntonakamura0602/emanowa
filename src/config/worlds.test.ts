import { describe, expect, it } from "vitest";

import {
  BASIC_WOOD_DESIGN,
  FEATURED_WORLD_SLUG,
  getWorldConfig,
  WORLD_2027,
} from "@/config/worlds";

describe("world configuration", () => {
  it("keeps the initial world independent from the current calendar year", () => {
    expect(FEATURED_WORLD_SLUG).toBe("2027");
    expect(getWorldConfig("2027")).toBe(WORLD_2027);
    expect(getWorldConfig("2026")).toBeNull();
  });

  it("uses the fixed UTC schedule and center from the specification", () => {
    expect(WORLD_2027).toMatchObject({
      width: 1000,
      height: 1000,
      opensAt: "2026-12-19T15:00:00.000Z",
      closesAt: "2027-12-31T15:00:00.000Z",
      initialCenter: { x: 500, y: 500 },
      displayTimeZone: "Asia/Tokyo",
    });
    expect(WORLD_2027.designIds).toEqual([BASIC_WOOD_DESIGN.id]);
  });
});
