import { describe, expect, it } from "vitest";

import { nearbyQuerySchema, nearbyResponseSchema } from "./schemas";

const PUBLIC_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("nearby query and response contracts", () => {
  it("accepts exactly one origin mode", () => {
    expect(nearbyQuerySchema.parse({ near: PUBLIC_ID })).toEqual({
      near: PUBLIC_ID,
    });
    expect(nearbyQuerySchema.parse({ x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
    });
    expect(nearbyQuerySchema.safeParse({}).success).toBe(false);
    expect(
      nearbyQuerySchema.safeParse({ near: PUBLIC_ID, x: 10, y: 20 }).success,
    ).toBe(false);
    expect(nearbyQuerySchema.safeParse({ x: 10 }).success).toBe(false);
  });

  it("accepts at most eight ordered candidates inside the searched radius", () => {
    const response = {
      origin: { x: 10, y: 10 },
      searchedRadius: 3 as const,
      candidates: [
        { x: 10, y: 10, slotNumber: 10_011 },
        { x: 10, y: 9, slotNumber: 9_011 },
        { x: 9, y: 10, slotNumber: 10_010 },
      ],
    };
    expect(nearbyResponseSchema.parse(response)).toEqual(response);

    expect(
      nearbyResponseSchema.safeParse({
        ...response,
        candidates: Array.from({ length: 9 }, (_, index) => ({
          x: 10 + index,
          y: 10,
          slotNumber: 10_011 + index,
        })),
      }).success,
    ).toBe(false);
  });

  it("rejects inconsistent, duplicate, out-of-radius, and unsorted candidates", () => {
    const base = {
      origin: { x: 10, y: 10 },
      searchedRadius: 3 as const,
    };
    expect(
      nearbyResponseSchema.safeParse({
        ...base,
        candidates: [{ x: 11, y: 10, slotNumber: 1 }],
      }).success,
    ).toBe(false);
    expect(
      nearbyResponseSchema.safeParse({
        ...base,
        candidates: [
          { x: 11, y: 10, slotNumber: 10_012 },
          { x: 11, y: 10, slotNumber: 10_012 },
        ],
      }).success,
    ).toBe(false);
    expect(
      nearbyResponseSchema.safeParse({
        ...base,
        candidates: [{ x: 14, y: 10, slotNumber: 10_015 }],
      }).success,
    ).toBe(false);
    expect(
      nearbyResponseSchema.safeParse({
        ...base,
        candidates: [
          { x: 12, y: 10, slotNumber: 10_013 },
          { x: 11, y: 10, slotNumber: 10_012 },
        ],
      }).success,
    ).toBe(false);
  });
});
