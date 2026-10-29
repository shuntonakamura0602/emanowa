import { describe, expect, it } from "vitest";

import { mapNearbyRows } from "./mappers";

describe("nearby database mapper", () => {
  it("distinguishes missing targets, empty results, and candidate rows", () => {
    expect(mapNearbyRows([])).toBeNull();
    expect(
      mapNearbyRows([
        {
          origin_x: 10,
          origin_y: 20,
          searched_radius: 20,
          candidate_x: null,
          candidate_y: null,
          slot_number: null,
        },
      ]),
    ).toEqual({
      origin: { x: 10, y: 20 },
      candidates: [],
      searchedRadius: 20,
    });
    expect(
      mapNearbyRows([
        {
          origin_x: 10,
          origin_y: 20,
          searched_radius: 3,
          candidate_x: 10,
          candidate_y: 19,
          slot_number: 19_011,
        },
        {
          origin_x: 10,
          origin_y: 20,
          searched_radius: 3,
          candidate_x: 9,
          candidate_y: 20,
          slot_number: 20_010,
        },
      ]),
    ).toEqual({
      origin: { x: 10, y: 20 },
      candidates: [
        { x: 10, y: 19, slotNumber: 19_011 },
        { x: 9, y: 20, slotNumber: 20_010 },
      ],
      searchedRadius: 3,
    });
  });

  it("rejects partial empty rows and inconsistent metadata", () => {
    expect(() =>
      mapNearbyRows([
        {
          origin_x: 10,
          origin_y: 20,
          searched_radius: 3,
          candidate_x: 9,
          candidate_y: null,
          slot_number: null,
        },
      ]),
    ).toThrow();
    expect(() =>
      mapNearbyRows([
        {
          origin_x: 10,
          origin_y: 20,
          searched_radius: 3,
          candidate_x: 10,
          candidate_y: 19,
          slot_number: 19_011,
        },
        {
          origin_x: 11,
          origin_y: 20,
          searched_radius: 3,
          candidate_x: 11,
          candidate_y: 19,
          slot_number: 19_012,
        },
      ]),
    ).toThrow();
  });
});
