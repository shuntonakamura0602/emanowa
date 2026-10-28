import { describe, expect, it } from "vitest";

import {
  decodeOwnerWorldCursor,
  encodeOwnerWorldCursor,
} from "@/server/api/owner-worlds-cursor";

const cursor = {
  updatedAt: "2026-12-20T00:00:00Z",
  publicId: "550e8400-e29b-41d4-a716-446655440000",
};

describe("owner world cursor", () => {
  it("round-trips a canonical strict cursor", () => {
    expect(decodeOwnerWorldCursor(encodeOwnerWorldCursor(cursor))).toEqual(
      cursor,
    );
    expect(decodeOwnerWorldCursor(null)).toBeNull();
  });

  it.each(["", "***", "e30", "a".repeat(513)])(
    "rejects invalid cursor %s",
    (value) => {
      expect(() => decodeOwnerWorldCursor(value)).toThrow();
    },
  );
});
