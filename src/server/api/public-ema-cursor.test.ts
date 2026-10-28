import { describe, expect, it } from "vitest";

import {
  decodePublicEmaCursor,
  encodePublicEmaCursor,
  publicFeedLimitQuerySchema,
} from "@/server/api/public-ema-cursor";
import { ApiRouteError } from "@/server/api/errors";

const cursor = {
  worldSlug: "2027",
  category: "health" as const,
  order: "newest" as const,
  createdAt: "2026-12-20T00:00:00.123456Z",
  publicId: "550e8400-e29b-41d4-a716-446655440000",
};

describe("public ema feed cursor", () => {
  it("round-trips only in the original world and category", () => {
    const encoded = encodePublicEmaCursor(cursor);
    expect(
      decodePublicEmaCursor(encoded, {
        worldSlug: "2027",
        category: "health",
      }),
    ).toEqual({
      createdAt: cursor.createdAt,
      publicId: cursor.publicId,
    });
    expect(
      decodePublicEmaCursor(null, { worldSlug: "2027", category: null }),
    ).toBeNull();
  });

  it("rejects a cursor reused across a world or category", () => {
    const encoded = encodePublicEmaCursor(cursor);
    expect(() =>
      decodePublicEmaCursor(encoded, {
        worldSlug: "2028",
        category: "health",
      }),
    ).toThrow();
    expect(() =>
      decodePublicEmaCursor(encoded, { worldSlug: "2027", category: null }),
    ).toThrow();
  });

  it.each(["", "***", "e30", "a".repeat(769)])(
    "rejects invalid cursor %s",
    (value) => {
      expect(() =>
        decodePublicEmaCursor(value, {
          worldSlug: "2027",
          category: "health",
        }),
      ).toThrow();
    },
  );

  it.each([
    "2026-02-31T00:00:00.000000Z",
    "2026-02-29T00:00:00.000000Z",
    "0000-01-01T00:00:00.000000Z",
    "2026-01-01T24:00:00.000000Z",
    "2026-01-01T23:60:00.000000Z",
    "2026-01-01T23:59:60.000000Z",
  ])("rejects nonexistent or out-of-range UTC datetime %s", (createdAt) => {
    const encoded = encodePublicEmaCursor({ ...cursor, createdAt });

    try {
      decodePublicEmaCursor(encoded, {
        worldSlug: "2027",
        category: "health",
      });
      expect.unreachable("invalid datetime cursor must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRouteError);
      expect(error).toMatchObject({ code: "INVALID_CURSOR", status: 400 });
    }
  });

  it.each([
    "2028-02-29T00:00:00Z",
    "2028-02-29T00:00:00.123Z",
    "2028-02-29T00:00:00.1234560Z",
    "2028-02-29T00:00:00.123456+00:00",
  ])("rejects noncanonical public cursor datetime %s", (createdAt) => {
    const encoded = encodePublicEmaCursor({ ...cursor, createdAt });
    expect(() =>
      decodePublicEmaCursor(encoded, {
        worldSlug: "2027",
        category: "health",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR", status: 400 }),
    );
  });

  it("accepts a real leap day and preserves all six microsecond digits", () => {
    const createdAt = "2028-02-29T23:59:59.000001Z";
    const encoded = encodePublicEmaCursor({ ...cursor, createdAt });

    expect(
      decodePublicEmaCursor(encoded, {
        worldSlug: "2027",
        category: "health",
      }),
    ).toEqual({ createdAt, publicId: cursor.publicId });
  });

  it("accepts only canonical base-10 limits from 1 through 50", () => {
    expect(publicFeedLimitQuerySchema.parse("1")).toBe(1);
    expect(publicFeedLimitQuerySchema.parse("50")).toBe(50);
    for (const value of ["0", "51", "01", "1e1", "0x10", "+1", " 1"]) {
      expect(publicFeedLimitQuerySchema.safeParse(value).success).toBe(false);
    }
  });
});
